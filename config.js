// Kredensial Supabase.
// anon key memang dirancang untuk publik — dia hanya bisa melakukan apa yang
// diizinkan Row Level Security di supabase-schema.sql. Yang HARUS dirahasiakan
// adalah service_role key: jangan pernah taruh di file ini.
window.SUPABASE_CONFIG = {
  url: 'https://tgktrtealplbzrsrhfee.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRna3RydGVhbHBsYnpyc3JoZmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1ODgzOTUsImV4cCI6MjEwNTE2NDM5NX0.aHxH3KGDhHf7rncKLKAtOg5_IPwLlpPBrDrScn-QSJo',
};
