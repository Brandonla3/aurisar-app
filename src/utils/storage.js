import { sb } from './supabase';
import { STORAGE_KEY } from '../data/constants';

async function loadSave(userId) {
  if(userId) {
    try {
      // Race Supabase against a 4s timeout — fall back to localStorage if slow
      const supabaseLoad = sb.from("profiles").select("data").eq("id",userId).single();
      const timeout = new Promise((_,reject) => setTimeout(()=>reject(new Error("timeout")), 4000));
      const {data,error} = await Promise.race([supabaseLoad, timeout]);
      if(!error && data) return data.data;
    } catch(e) {
      // Timeout or network error — fall through to localStorage
    }
  }
  // Fallback to localStorage
  try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch(e) { return null; }
}

async function doSave(data, userId, userEmail) {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); } catch(e) {}
  if(userId) {
    // Include email in saved data so friend search can find users by email
    const saveData = userEmail ? {...data, email:userEmail.toLowerCase()} : data;
    try { await sb.from("profiles").upsert({id:userId, data:saveData, updated_at:new Date().toISOString()}); } catch(e) {}
  }
}

export { loadSave, doSave };
