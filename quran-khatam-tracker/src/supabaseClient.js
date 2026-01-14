import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://etjhzwdyqogkqfdubbrn.supabase.co"
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0amh6d2R5cW9na3FmZHViYnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MTE1NzMsImV4cCI6MjA4Mzk4NzU3M30.xmGJ3MN1Y4m3wDLXhlZ7yu31LssormUaExWUqmS1CJ0"

export const supabase = createClient(supabaseUrl, supabaseKey)