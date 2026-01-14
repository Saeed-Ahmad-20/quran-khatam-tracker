import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  // --- STATE ---
  const [juzs, setJuzs] = useState([]);
  const [meta, setMeta] = useState({ khatam_count: 0, last_month: '' });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Store the calculated month in state since we fetch it async
  const [currentHijriMonth, setCurrentHijriMonth] = useState('');

  // --- 1. GET ACCURATE HIJRI DATE (API) ---
  const getHijriDate = async () => {
    try {
      const today = new Date();
      // Format: DD-MM-YYYY
      const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
      
      // Fetch from Aladhan API
      const response = await fetch(`https://api.aladhan.com/v1/gToH?date=${dateStr}`);
      const data = await response.json();
      
      if (data && data.data && data.data.hijri) {
        return data.data.hijri.month.en; // Returns "Rajab", "Sha'ban", etc.
      }
    } catch (e) {
      console.warn("API failed, falling back to device date", e);
    }
    // Fallback if API fails: Use device's best guess
    return new Intl.DateTimeFormat('en-u-ca-islamic', { month: 'long' }).format(Date.now());
  };

  // --- 2. RESET HELPER ---
  const fullReset = async (currentCount, monthName) => {
    setLoading(true);
    await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    window.location.reload();
  };

  // --- 3. FETCH DATA & CHECK MONTH ---
  const fetchData = useCallback(async () => {
    try {
      // A. Determine Month First
      const hijriMonthName = await getHijriDate();
      setCurrentHijriMonth(hijriMonthName);

      // B. Fetch Juz Data
      const { data: juzData, error: juzError } = await supabase
        .from('khatam_tracker').select('*').order('juz_number');
      if (juzError) throw juzError;
      if (juzData) setJuzs(juzData);

      // C. Fetch Metadata
      const { data: metaData, error: metaError } = await supabase
        .from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaError) {
        setMeta({ khatam_count: 0, last_month: hijriMonthName });
      } else {
        // D. Auto-Reset Logic
        if (metaData.last_month && metaData.last_month !== hijriMonthName) {
          // New month detected! Reset everything.
          await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
          await supabase.from('khatam_metadata').update({ khatam_count: 0, last_month: hijriMonthName }).eq('id', 1);
          window.location.reload();
        } else {
          setMeta(metaData);
        }
      }
    } catch (error) {
      console.error("Error:", error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- 4. LISTENERS ---
  useEffect(() => {
    fetchData();
    const subscription = supabase
      .channel('public:khatam_tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_tracker' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_metadata' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(subscription); };
  }, [fetchData]);

  // --- 5. ACTIONS ---
  const toggleSelect = (num) => {
    if (selected.includes(num)) setSelected(selected.filter(n => n !== num));
    else setSelected([...selected, num]);
  };

  const handleClaim = async () => {
    if (selected.length === 0) return;
    const toClaim = [...selected];
    setSelected([]); 

    const { error } = await supabase.from('khatam_tracker').update({ status: 'taken' }).in('juz_number', toClaim);
    
    if (error) {
      alert("❌ Error: " + error.message);
      setSelected(toClaim);
      return;
    }

    const { data } = await supabase.from('khatam_tracker').select('status');
    const takenCount = data ? data.filter(r => r.status === 'taken').length : 0;

    if (takenCount === 30) {
      alert(`Mabrook! Khatam #${(meta.khatam_count || 0) + 1} Completed!`);
      await fullReset((meta.khatam_count || 0) + 1, currentHijriMonth);
    } else {
      window.location.reload();
    }
  };

  const takenCount = juzs ? juzs.filter(j => j.status === 'taken').length : 0;
  const progress = (takenCount / 30) * 100;

  if (loading) return <div className="app-container"><h2>Loading...</h2></div>;

  return (
    <div className="app-container">
      <h1>📖 {currentHijriMonth} Khatam</h1>
      <h3>Khatams Completed: {meta?.khatam_count || 0}</h3>
      <p>Select your Juz and press Claim.</p>

      {juzs.length === 0 && (
        <div style={{ color: 'red', border: '1px solid red', padding: '10px' }}>
          <strong>Error: No Juz found.</strong> Run the SQL INSERT command in Supabase.
        </div>
      )}

      <div className="juz-grid">
        {juzs.map((juz) => {
          const isTaken = juz.status === 'taken';
          const isSelected = selected.includes(juz.juz_number);
          
          return (
            <button
              key={juz.id}
              disabled={isTaken}
              className={`juz-box ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleSelect(juz.juz_number)}
            >
              {juz.juz_number} {isSelected && "✔"}
            </button>
          );
        })}
      </div>

      <div className="progress-container">
        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      </div>
      <p>{takenCount} / 30 Juz Taken</p>

      <button 
        className="claim-btn" 
        disabled={selected.length === 0} 
        onClick={handleClaim}
      >
        Confirm & Claim ({selected.length})
      </button>
    </div>
  );
}

export default App;