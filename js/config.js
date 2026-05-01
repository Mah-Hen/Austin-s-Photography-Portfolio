// js/config.js
const CONFIG = {
  supabaseUrl: 'https://ymrilrogtrrinsxhbwik.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inltcmlscm9ndHJyaW5zeGhid2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTgwMTYsImV4cCI6MjA5MjYzNDAxNn0.ZnQxBzErrfQMRDa2TvMWsz8CtjI-ue9PM814koBUjwo',
  storageBucket: 'portfolio-images',

    // Your deployed Edge Function URL
  // Found at: Supabase Dashboard → Edge Functions → upload-photo → Details
  edgeFunctionUrl: 'https://ymrilrogtrrinsxhbwik.functions.supabase.co/functions/v1/upload-photo',


  // Image constraints (compression happens before the file reaches the server)
  maxFileSizeMB: 10,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  compressionQuality: 0.82,
  compressionMaxDimension: 2000,
 
  // Gallery settings
  imagesPerPage: 30,

};

export default CONFIG;