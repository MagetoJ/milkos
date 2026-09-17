'use client';
import { useState } from 'react';

export default function ApplicationStatus(){
 const [reference,setReference]=useState(''); const [data,setData]=useState<any>(); const [error,setError]=useState('');
 async function lookup(e:any){e.preventDefault();setError('');setData(undefined);try{const r=await fetch(`${process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000/api/v1'}/cooperatives/applications/${encodeURIComponent(reference.trim())}`);if(!r.ok)throw new Error('Application not found');setData(await r.json())}catch(e:any){setError(e.message)}}
 return <main className="landing"><div className="formcard"><div className="eyebrow">APPLICATION STATUS</div><h1>Track your cooperative</h1><p>Enter the application reference you received after submission.</p><form onSubmit={lookup}><label>Application reference<input required value={reference} onChange={e=>setReference(e.target.value)} placeholder="COOP-2026-XXXXXXXX" /></label><button className="primary" type="submit">Check status</button></form>{error&&<div className="error">{error}</div>}{data&&<div className="statusbox"><strong>{data.cooperativeName}</strong><span className={`status ${String(data.status).toLowerCase()}`}>{String(data.status).replaceAll('_',' ')}</span><small>Submitted {new Date(data.submittedAt).toLocaleString()}</small>{data.notes&&<p>{data.notes}</p>}</div>}</div></main>
}
