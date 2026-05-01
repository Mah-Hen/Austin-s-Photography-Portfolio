/**
 * supabase.js — Thin wrapper around Supabase REST API
 *
 * We use the Supabase JS SDK loaded from CDN (see index.html).
 * This module exposes clean functions for the rest of the app.
 *
 * Database schema assumed (run in Supabase SQL editor):
 *
 *   CREATE TABLE photos (
 *     id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     title       text NOT NULL DEFAULT '',
 *     caption     text DEFAULT '',
 *     file_name   text NOT NULL,
 *     storage_path text NOT NULL,
 *     public_url  text NOT NULL,
 *     size_bytes  integer,
 *     width       integer,
 *     height      integer,
 *     created_at  timestamptz DEFAULT now()
 *   );
 *
 *   -- Allow anyone to read (public gallery)
 *   ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "public read" ON photos FOR SELECT USING (true);
 *
 *   -- Allow inserts only from authenticated users (or use anon for simple password flow)
 *   -- For this simple implementation, we allow anon insert:
 *   CREATE POLICY "anon insert" ON photos FOR INSERT WITH CHECK (true);
 *   CREATE POLICY "anon delete" ON photos FOR DELETE USING (true);
 *
 *   -- Storage bucket: make it public
 *   -- In Supabase dashboard: Storage → New bucket → Name: portfolio-images → Public ✓
 */

import CONFIG from './config.js';

let _client = null;

/**
 * Lazily initialize the Supabase client.
 * Requires the @supabase/supabase-js script to be loaded.
 */
function getClient() {
  if (_client) return _client;

  if (!window.supabase?.createClient) {
    throw new Error('Supabase SDK not loaded. Check your <script> tag.');
  }

  _client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return _client;
}

/**
 * Exported alias — used by app.js for Auth calls.
 */
export function getSupabaseClient() {
  return getClient();
}

/**
 * Fetch all photos, newest first.
 * @returns {Promise<Array>} Array of photo records
 */
export async function fetchPhotos() {
  const { data, error } = await getClient()
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(CONFIG.imagesPerPage);

  if (error) throw error;
  return data ?? [];
}

/**
 * Upload an image file to Supabase Storage, then insert a record in the DB.
 * @param {File} file          The (possibly compressed) image file
 * @param {string} title       User-provided title
 * @param {string} caption     Optional caption
 * @param {Function} onProgress Called with 0–100 progress value
 * @returns {Promise<Object>}  The inserted photo record
 */
export async function uploadPhoto(file, title, caption, onProgress = () => {}) {
  const client = getClient();

  // 1. Build a unique storage path
  const timestamp = Date.now();
  const ext = file.name.split('.').pop().toLowerCase();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `uploads/${timestamp}_${safeName}`;

  onProgress(10);

  // 2. Upload to Supabase Storage
  // Note: The Supabase JS SDK doesn't natively report upload progress
  // for simple uploads. For large files, use TUS resumable upload.
  const { data: storageData, error: storageError } = await client.storage
    .from(CONFIG.storageBucket)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,          // fail if path already exists
    });

  if (storageError) throw storageError;

  onProgress(70);

  // 3. Get the public URL
  const { data: urlData } = client.storage
    .from(CONFIG.storageBucket)
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // 4. Read image dimensions (for display layout hints)
  const dimensions = await getImageDimensions(file);

  onProgress(85);

  // 5. Insert metadata row in the DB
  const { data: record, error: dbError } = await client
    .from('photos')
    .insert({
      title:        title || file.name,
      caption:      caption || '',
      file_name:    file.name,
      storage_path: storagePath,
      public_url:   publicUrl,
      size_bytes:   file.size,
      width:        dimensions.width,
      height:       dimensions.height,
    })
    .select()
    .single();

  if (dbError) throw dbError;

  onProgress(100);
  return record;
}

/**
 * Delete a photo from Storage and from the DB.
 * @param {Object} photo  Photo record (needs id and storage_path)
 */
export async function deletePhoto(photo) {
  const client = getClient();

  // Delete from storage first
  const { error: storageError } = await client.storage
    .from(CONFIG.storageBucket)
    .remove([photo.storage_path]);

  if (storageError) console.warn('Storage delete error:', storageError);

  // Delete DB row
  const { error: dbError } = await client
    .from('photos')
    .delete()
    .eq('id', photo.id);

  if (dbError) throw dbError;
}

/**
 * Helper: get image width/height from a File object
 */
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}