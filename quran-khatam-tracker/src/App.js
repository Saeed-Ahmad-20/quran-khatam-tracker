import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

// --- COMPONENT: EXPANDABLE KHATAM (Level 2) ---
const KhatamGroup = ({ khatamNum, monthName, entries }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ marginBottom: '10px', border: '1px solid #ddd', borderRadius: '5px', overflow: 'hidden' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: '100%', padding: '10px', background: '#f1f3f5', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <strong>Khatam #{khatamNum}</strong>
        <span style={{ fontSize: '0.8rem', color: '#666' }}>{isOpen ? '▲' : '▼'}</span>
      </button>
      
      {isOpen && (
        <div style={{ padding: '10px', background: 'white', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
          {entries.sort((a,b) => a.juz_number - b.juz_number).map(entry => (
            <div key={entry.id} style={{ fontSize: '0.85rem', padding: '4px 6px', border: '1px solid #eee', borderRadius: '4px', background: '#fafafa' }}>
              <b style={{ color: '#2c3e50' }}>{entry.juz_number}:</b> {entry.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- COMPONENT: EXPANDABLE MONTH (Level 1) ---
const MonthGroup = ({ monthName, entries }) => {
  const [isOpen, setIsOpen] = useState(false);
  const uniqueKhatams = [...new Set(entries.map(e => e.khatam_number))].sort((a, b) => b - a);

  return (
    <div style={{ marginBottom: '15px' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{ width: '100%', padding: '12px', background: '#2c3e50', color: 'white', border: 'none', borderRadius: '5px', textAlign: 'left', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>📂 {monthName} <span style={{ fontWeight: 'normal', opacity: 0.8, fontSize: '0.9rem' }}>({uniqueKhatams.length} Khatams)</span></span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div style={{ padding: '10px 0 0 10px', borderLeft: '3px solid #eee', marginLeft: '10px' }}>
          {uniqueKhatams.map(kNum => (
            <KhatamGroup 
              key={kNum} 
              khatamNum={kNum} 
              monthName={monthName}
              entries={entries.filter(e => e.khatam_number === kNum)} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- MAIN APP ---
function App() {
  const [juzs, setJuzs] = useState([]);
  const [meta, setMeta] = useState({ khatam_count: 0, last_month: '' });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentHijriMonth, setCurrentHijriMonth] = useState('');
  const [userName, setUserName] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);

  // --- 1. API: GET ACCURATE HIJRI DATE ---
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

  // --- 2. ARCHIVE & RESET LOGIC ---
  const archiveAndReset = async (currentCount, monthName) => {
    setLoading(true);
    const { data: currentJuzs } = await supabase.from('khatam_tracker').select('*');
    
    const historyRows = currentJuzs.map(j => ({
      khatam_number: currentCount,
      juz_number: j.juz_number,
      name: j.name || 'Anonymous',
      month_name: monthName
    }));

    await supabase.from('khatam_history').insert(historyRows);
    await supabase.from('khatam_tracker').update({ status: '', name: '' }).neq('id', 0);
    await supabase.from('khatam_metadata').update({ khatam_count: currentCount, last_month: monthName }).eq('id', 1);
    
    window.location.reload();
  };

  // --- 3. DATA FETCHING ---
  const fetchData = useCallback(async () => {
    try {
      const hijriMonthName = await getHijriDate();
      setCurrentHijriMonth(hijriMonthName);

      const { data: juzData } = await supabase.from('khatam_tracker').select('*').order('juz_number');
      if (juzData) setJuzs(juzData);

      const { data: metaData } = await supabase.from('khatam_metadata').select('*').eq('id', 1).single();

      if (metaData) {
        if (metaData.last_month && metaData.last_month !== hijriMonthName) {
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

  // --- 4. HISTORY FETCHING ---
  const fetchHistory = async () => {
    if (!showHistory) {
      const { data } = await supabase.from('khatam_history').select('*');
      setHistoryData(data || []);
    }
    setShowHistory(!showHistory);
  };

  // --- 5. SUBSCRIPTION ---
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

    const { data } = await supabase.from('khatam_tracker').select('status');
    const takenCount = data ? data.filter(r => r.status === 'taken').length : 0;

    if (takenCount === 30) {
      // --- CHANGED MESSAGE HERE ---
      alert("Mubarak on Completing a Khatam");
      
      await archiveAndReset((meta.khatam_count || 0) + 1, currentHijriMonth);
    } else {
      window.location.reload();
    }
  };

  const getUniqueMonths = () => [...new Set(historyData.map(item => item.month_name))];
  const takenCount = juzs ? juzs.filter(j => j.status === 'taken').length : 0;
  const progress = (takenCount / 30) * 100;

  if (loading) return <div className="app-container"><h2>Loading...</h2></div>;

  return (
    <div className="app-container">
      <h1>📖 {currentHijriMonth} Khatam</h1>
      <h3>Khatams Completed: {meta?.khatam_count || 0}</h3>

      <button 
        onClick={fetchHistory}
        style={{ marginBottom: '20px', padding: '10px 20px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '1rem' }}
      >
        {showHistory ? "← Back to Tracker" : "📜 View Past Khatams"}
      </button>

      {showHistory && (
        <div style={{ textAlign: 'left', background: '#f8f9fa', padding: '15px', borderRadius: '10px', marginBottom: '20px', maxHeight: '500px', overflowY: 'auto' }}>
          <h2 style={{marginTop: 0, color: '#333'}}>History Archive</h2>
          {historyData.length === 0 ? <p>No history records found.</p> : (
            getUniqueMonths().map(month => (
              <MonthGroup 
                key={month} 
                monthName={month} 
                entries={historyData.filter(d => d.month_name === month)} 
              />
            ))
          )}
        </div>
      )}

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
            <input 
              type="text" 
              placeholder="Enter your name..." 
              value={userName} 
              onChange={(e) => setUserName(e.target.value)} 
              style={{ padding: '15px', fontSize: '1.1rem', borderRadius: '10px', border: '2px solid #ccc', textAlign: 'center' }} 
            />
            <button className="claim-btn" disabled={selected.length === 0} onClick={handleClaim}>Confirm & Claim ({selected.length})</button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;