import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, getDocFromServer } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

let firebaseConfig;
try {
  firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
} catch (e) {
  console.error("Missing firebase-applet-config.json. Backend will fall back to local disk if needed, but errors may occur.");
  firebaseConfig = {}; // App will likely crash if used without config, but we have it.
}

const app = initializeApp(firebaseConfig);
// @ts-ignore
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export async function getSimulations() {
  try {
    const q = query(collection(db, "simulations"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.error("Firestore getSimulations error:", err);
    return [];
  }
}

export async function getSimulation(simId: string) {
  try {
    const d = await getDoc(doc(db, "simulations", simId));
    return d.exists() ? d.data() : null;
  } catch (err) {
    console.error("Firestore getSimulation error:", err);
    return null;
  }
}

export async function saveSimulation(sim: any) {
  try {
    await setDoc(doc(db, "simulations", sim.id), sim, { merge: true });
  } catch (err) {
    console.error("Firestore saveSimulation error:", err);
  }
}

export async function deleteSimulation(simId: string) {
  try {
    await deleteDoc(doc(db, "simulations", simId));
  } catch (err) {
    console.error("Firestore deleteSimulation error:", err);
  }
}

export async function getEvents() {
    try {
      const q = query(collection(db, "events"));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (err) {
      console.error("Firestore getEvents error:", err);
      return [];
    }
}
  
export async function saveEvent(event: any) {
    try {
      await setDoc(doc(db, "events", event.id), event);
    } catch (err) {
      console.error("Firestore saveEvent error:", err);
    }
}
