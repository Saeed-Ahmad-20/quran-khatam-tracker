import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  // --- STATE ---
  const [juzs, setJuzs] = useState([]);
  const [meta, setMeta] = useState({ khatam_count: 0, last_month: '' });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentHijriMonth, setCurrentHijriMonth] = useState('');
  
  // NEW: State for the user's name
  const [userName, setUserName] = useState('');

  // --- 1. GET ACCURATE HIJRI DATE (API) ---
  const getHijriDate = async () => {
    try {
      const today = new Date();
      const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
      const response = await fetch(`https://api.aladhan.com/v1/gToH?date=${dateStr}`);
      const data = await response.json();
      if (data?.data?.hijri?.month?.en) return data.data.hijri.month.en;
    } catch (e) {
      console.warn("API failed", e);
    }
    return new Intl.DateTimeFormat('en-u-ca-islamic', { month: 'long' }).format(Date.now());
  };

  // --- 2. RESET HELPER ---
  const fullReset = async (currentCount, monthName) => {
    setLoading(true);
    // Reset status AND name
    await supabase.from('khatam_tracker').update({ status: '', name: '' }).neq('id', 0);
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    window.location.reload();
  };

  // --- 3. FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      const hijriMonthName = await getHijriDate();
      setCurrentHijriMonth(hijriMonthName);

      const { data: juzData, error: juzError } = await supabase
        .from('khatam_tracker').select('*').order('juz_number');
      if (juzError) throw juzError;
      if (juzData) setJuzs(juzData);

      const { data: metaData, error: metaError } = await supabase
        .from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaError) {
        setMeta({ khatam_count: 0, last_month: hijriMonthName });
      } else {
        if (metaData.last_month && metaData.last_month !== hijriMonthName) {
          await supabase.from('khatam_tracker').update({ status: '', name: '' }).neq('id', 0);
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
    
    // VALIDATION: Name is required
    if (!userName.trim()) {
      alert("Please enter your name first!");
      return;
    }

    const toClaim = [...selected];
    const nameToSave = userName; // Capture name at this moment
    setSelected([]); 
    setUserName(''); // Clear input

    // Update DB with STATUS and NAME
    const { error } = await supabase
      .from('khatam_tracker')
      .update({ status: 'taken', name: nameToSave })
      .in('juz_number', toClaim);
    
    if (error) {
      alert("❌ Error: " + error.message);
      setSelected(toClaim);
      return;
    }

    // Check Completion
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
      <p>Select your Juz, enter name, and Claim.</p>

      {juzs.length === 0 && (
        <div style={{ color: 'red', border: '1px solid red', padding: '10px' }}>
          <strong>Error: No Juz found.</strong> Run the SQL INSERT command.
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
              {/* SHOW NUMBER OR NAME */}
              {isTaken ? (
                <span style={{fontSize: '0.9rem', color: '#555'}}>
                  {juz.juz_number}<br/>
                  <small>{juz.name ? juz.name.substring(0, 8) : 'Taken'}</small>
                </span>
              ) : (
                <span>{juz.juz_number} {isSelected && "✔"}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="progress-container">
        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      </div>
      <p>{takenCount} / 30 Juz Taken</p>

      {/* NAME INPUT SECTION */}
      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <input
          type="text"
          placeholder="Enter your name..."
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          style={{
            padding: '15px',
            fontSize: '1.1rem',
            borderRadius: '10px',
            border: '2px solid #ccc',
            textAlign: 'center'
          }}
        />
        
        <button 
          className="claim-btn" 
          disabled={selected.length === 0} 
          onClick={handleClaim}
        >
          Confirm & Claim ({selected.length})
        </button>
      </div>
    </div>
  );
}

export default App;