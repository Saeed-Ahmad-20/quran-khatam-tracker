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
  const [userName, setUserName] = useState('');
  
  // HISTORY STATE
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);

  // --- 1. GET ACCURATE HIJRI DATE ---
  const getHijriDate = async () => {
    try {
      const today = new Date();
      const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
      const response = await fetch(`https://api.aladhan.com/v1/gToH?date=${dateStr}`);
      const data = await response.json();
      if (data?.data?.hijri?.month?.en) return data.data.hijri.month.en;
    } catch (e) { console.warn("API failed", e); }
    return new Intl.DateTimeFormat('en-u-ca-islamic', { month: 'long' }).format(Date.now());
  };

  // --- 2. ARCHIVE & RESET ---
  const archiveAndReset = async (currentCount, monthName) => {
    setLoading(true);

    // A. ARCHIVE: Get all current names and save to history
    const { data: currentJuzs } = await supabase.from('khatam_tracker').select('*');
    
    // Prepare rows for history table
    const historyRows = currentJuzs.map(j => ({
      khatam_number: currentCount, // This is the Khatam we just finished
      juz_number: j.juz_number,
      name: j.name || 'Anonymous',
      month_name: monthName
    }));

    await supabase.from('khatam_history').insert(historyRows);

    // B. RESET: Wipe the board
    await supabase.from('khatam_tracker').update({ status: '', name: '' }).neq('id', 0);
    
    // C. UPDATE COUNT
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    
    window.location.reload();
  };

  // --- 3. FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      const hijriMonthName = await getHijriDate();
      setCurrentHijriMonth(hijriMonthName);

      const { data: juzData } = await supabase.from('khatam_tracker').select('*').order('juz_number');
      if (juzData) setJuzs(juzData);

      const { data: metaData } = await supabase.from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaData) {
        if (metaData.last_month && metaData.last_month !== hijriMonthName) {
           // New Month: Reset but DON'T archive (assuming unused board)
           await supabase.from('khatam_tracker').update({ status: '', name: '' }).neq('id', 0);
           await supabase.from('khatam_metadata').update({ khatam_count: 0, last_month: hijriMonthName }).eq('id', 1);
           window.location.reload();
        } else {
          setMeta(metaData);
        }
      }
    } catch (error) { console.error("Error:", error.message); } 
    finally { setLoading(false); }
  }, []);

  // --- 4. FETCH HISTORY ---
  const fetchHistory = async () => {
    const { data } = await supabase
      .from('khatam_history')
      .select('*')
      .order('khatam_number', { ascending: false }) // Newest Khatams first
      .order('juz_number', { ascending: true });
    
    setHistoryData(data || []);
    setShowHistory(!showHistory);
  };

  // --- 5. LISTENERS ---
  useEffect(() => {
    fetchData();
    const subscription = supabase
      .channel('public:khatam_tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_tracker' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_metadata' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(subscription); };
  }, [fetchData]);

  // --- 6. ACTIONS ---
  const toggleSelect = (num) => {
    if (selected.includes(num)) setSelected(selected.filter(n => n !== num));
    else setSelected([...selected, num]);
  };

  const handleClaim = async () => {
    if (selected.length === 0 || !userName.trim()) {
      alert("Please select a Juz and enter your name.");
      return;
    }

    const toClaim = [...selected];
    const nameToSave = userName;
    setSelected([]); 
    setUserName('');

    const { error } = await supabase.from('khatam_tracker')
      .update({ status: 'taken', name: nameToSave }).in('juz_number', toClaim);
    
    if (error) {
      alert("❌ Error: " + error.message);
      setSelected(toClaim);
      return;
    }

    // Check Completion
    const { data } = await supabase.from('khatam_tracker').select('status');
    const takenCount = data ? data.filter(r => r.status === 'taken').length : 0;

    if (takenCount === 30) {
      alert(`Mabrook! Khatam #${(meta.khatam_count || 0) + 1} Completed! archiving...`);
      // Pass the NEW count number to archive
      await archiveAndReset((meta.khatam_count || 0) + 1, currentHijriMonth);
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

      {/* VIEW HISTORY BUTTON */}
      <button 
        onClick={fetchHistory}
        style={{ marginBottom: '20px', padding: '8px 16px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
      >
        {showHistory ? "Hide History" : "📜 View Past Khatams"}
      </button>

      {/* HISTORY SECTION */}
      {showHistory && (
        <div style={{ textAlign: 'left', background: '#f8f9fa', padding: '15px', borderRadius: '10px', marginBottom: '20px', maxHeight: '300px', overflowY: 'auto' }}>
          <h3>History Archive</h3>
          {historyData.length === 0 ? <p>No history yet.</p> : (
            // Group by Khatam Number
            [...new Set(historyData.map(i => i.khatam_number))].map(kNum => (
              <div key={kNum} style={{ marginBottom: '15px', borderBottom: '1px solid #ddd', paddingBottom: '10px' }}>
                <strong style={{ color: '#2c3e50' }}>Khatam #{kNum} ({historyData.find(d => d.khatam_number === kNum).month_name})</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', marginTop: '5px', fontSize: '0.8rem' }}>
                  {historyData.filter(h => h.khatam_number === kNum).map(h => (
                    <div key={h.id} style={{ background: '#fff', padding: '2px 5px', border: '1px solid #eee' }}>
                      <b>{h.juz_number}:</b> {h.name}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* MAIN TRACKER UI */}
      {!showHistory && (
        <>
          <p>Select your Juz, enter name, and Claim.</p>
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
                  {isTaken ? (
                    <span style={{fontSize: '0.9rem', color: '#555'}}>
                      {juz.juz_number}<br/><small>{juz.name ? juz.name.substring(0, 8) : 'Taken'}</small>
                    </span>
                  ) : (
                    <span>{juz.juz_number} {isSelected && "✔"}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="progress-container"><div className="progress-bar" style={{ width: `${progress}%` }}></div></div>
          <p>{takenCount} / 30 Juz Taken</p>

          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input type="text" placeholder="Enter your name..." value={userName} onChange={(e) => setUserName(e.target.value)} style={{ padding: '15px', fontSize: '1.1rem', borderRadius: '10px', border: '2px solid #ccc', textAlign: 'center' }} />
            <button className="claim-btn" disabled={selected.length === 0} onClick={handleClaim}>Confirm & Claim ({selected.length})</button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;