import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  // --- STATE ---
  const [juzs, setJuzs] = useState([]);
  const [meta, setMeta] = useState({ khatam_count: 0, last_month: '' });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);

  // Get Hijri Month
  const currentHijriMonth = new Intl.DateTimeFormat('en-u-ca-islamic', { month: 'long' }).format(Date.now());

  // --- 1. RESET HELPER ---
  const fullReset = async (currentCount, monthName) => {
    setLoading(true);
    // Reset all Juz statuses
    await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
    // Update Metadata
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    window.location.reload();
  };

  // --- 2. FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      // Fetch Juz List
      const { data: juzData, error: juzError } = await supabase
        .from('khatam_tracker').select('*').order('juz_number');
      
      if (juzError) throw juzError;
      if (juzData) setJuzs(juzData);

      // Fetch Metadata
      const { data: metaData, error: metaError } = await supabase
        .from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaError) {
        console.warn("Metadata check failed (first run?):", metaError.message);
        setMeta({ khatam_count: 0, last_month: currentHijriMonth });
      } else {
        // Auto-Reset Logic
        if (metaData.last_month && metaData.last_month !== currentHijriMonth) {
          await supabase.from('khatam_tracker').update({ status: '' }).neq('id', 0);
          await supabase.from('khatam_metadata').update({ khatam_count: 0, last_month: currentHijriMonth }).eq('id', 1);
          window.location.reload();
        } else {
          setMeta(metaData);
        }
      }
    } catch (error) {
      console.error("Connection Error:", error.message);
    } finally {
      setLoading(false);
    }
  }, [currentHijriMonth]);

  // --- 3. REAL-TIME LISTENER ---
  useEffect(() => {
    fetchData();
    const subscription = supabase
      .channel('public:khatam_tracker')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_tracker' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'khatam_metadata' }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(subscription); };
  }, [fetchData]);

  // --- 4. UI ACTIONS ---
  const toggleSelect = (num) => {
    if (selected.includes(num)) setSelected(selected.filter(n => n !== num));
    else setSelected([...selected, num]);
  };

  const handleClaim = async () => {
    if (selected.length === 0) return;

    // Optimistic Update: Clear selection immediately
    const toClaim = [...selected];
    setSelected([]); 

    // Update DB
    const { error } = await supabase
      .from('khatam_tracker')
      .update({ status: 'taken' })
      .in('juz_number', toClaim);
    
    // CRITICAL: Error Alert
    if (error) {
      console.error("Supabase Error:", error);
      alert("❌ Error: " + error.message + "\n\n(Hint: Check RLS Policies in Supabase)");
      setSelected(toClaim); // Undo selection clear so user can try again
      return;
    }

    // Check Completion
    const { data } = await supabase.from('khatam_tracker').select('status');
    const takenCount = data ? data.filter(r => r.status === 'taken').length : 0;

    if (takenCount === 30) {
      alert(`Mabrook! Khatam #${(meta.khatam_count || 0) + 1} Completed!`);
      await fullReset((meta.khatam_count || 0) + 1, currentHijriMonth);
    } else {
      // --- NEW: FORCE REFRESH AFTER CLAIM ---
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

      {/* Database Empty Warning */}
      {juzs.length === 0 && (
        <div style={{ color: 'red', border: '1px solid red', padding: '10px', margin: '20px' }}>
          <strong>Error: No Juz found.</strong><br/>
          Go to Supabase SQL Editor and run the INSERT command.
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