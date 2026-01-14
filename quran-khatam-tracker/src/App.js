import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  // --- STATE ---
  const [juzs, setJuzs] = useState([]);
  const [meta, setMeta] = useState({ khatam_count: 0, last_month: '' });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- HELPER: ROBUST HIJRI DATE CALCULATOR ---
  // This replaces the browser's buggy "Intl" function
  const getHijriMonth = () => {
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth(); // 0-11
    const year = today.getFullYear();

    let m = month + 1;
    let y = year;
    if (m < 3) { y -= 1; m += 12; }

    let a = Math.floor(y / 100);
    let b = 2 - a + Math.floor(a / 4);
    if (y < 1583) b = 0;
    if (y === 1582) {
      if (m > 10) b = -10;
      if (m === 10) {
        b = 0;
        if (day > 4) b = -10;
      }
    }

    const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;

    const b0 = 0;
    const days = 354.367068;
    const months = 29.5305879;
    const index = Math.floor((jd - 2151969.5) / days);
    const h_year = Math.floor(index / 30) + 1700;
    const h_month_index = Math.floor((jd - 2151969.5 - index * days) / months);
    
    // List of Month Names
    const iMonthNames = [
      "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani",
      "Jumada al-Awwal", "Jumada al-Thani", "Rajab", "Sha'ban",
      "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"
    ];

    return iMonthNames[h_month_index % 12];
  };

  // USE THE NEW FUNCTION
  const currentHijriMonth = getHijriMonth();

  // --- 1. RESET HELPER ---
  const fullReset = async (currentCount, monthName) => {
    setLoading(true);
    await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    window.location.reload();
  };

  // --- 2. FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      // Fetch Juz
      const { data: juzData, error: juzError } = await supabase
        .from('khatam_tracker').select('*').order('juz_number');
      if (juzError) throw juzError;
      if (juzData) setJuzs(juzData);

      // Fetch Metadata
      const { data: metaData, error: metaError } = await supabase
        .from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaError) {
        setMeta({ khatam_count: 0, last_month: currentHijriMonth });
      } else {
        // Auto-Reset Check
        if (metaData.last_month && metaData.last_month !== currentHijriMonth) {
          await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
          await supabase.from('khatam_metadata').update({ khatam_count: 0, last_month: currentHijriMonth }).eq('id', 1);
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
  }, [currentHijriMonth]);

  // --- 3. LISTENERS ---
  useEffect(() => {
    fetchData();
    const subscription = supabase
      .channel('public:khatam_tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_tracker' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_metadata' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(subscription); };
  }, [fetchData]);

  // --- 4. ACTIONS ---
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