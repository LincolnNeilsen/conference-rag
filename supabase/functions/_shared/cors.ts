// Shared CORS headers for every Edge Function.
// '*' lets the GitHub Pages site call the function. Security comes from the
// JWT check in each function, not from the origin.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
