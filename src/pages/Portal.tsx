import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { Loader2, Play, Trash2, Globe } from 'lucide-react';

interface Simulation {
  id: string;
  repoUrl: string;
  url: string;
}

export default function Portal() {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [activeSim, setActiveSim] = useState<Simulation | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('render_simulations');
    if (stored) setSimulations(JSON.parse(stored));
  }, []);

  const saveToStorage = (newSims: Simulation[]) => {
    setSimulations(newSims);
    localStorage.setItem('render_simulations', JSON.stringify(newSims));
  }

  const handleImport = async () => {
    if (!repoUrl) return;
    setLoading(true);
    try {
        const res = await fetch('https://ssw-ovxm.onrender.com/import-repo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoUrl })
        });
        const data = await res.json();
        
        if (res.ok) {
            const newSim = { 
                id: Date.now().toString(),
                repoUrl,
                url: `https://ssw-ovxm.onrender.com${data.path}` 
            };
            saveToStorage([...simulations, newSim]);
            setActiveSim(newSim);
            toast.success('Simulation imported!');
        } else {
            toast.error(data.message || 'Import failed');
        }
    } catch (e) {
        toast.error('Connection failed');
    } finally {
        setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
        <h1 className="text-3xl font-bold">Render Portal</h1>
        <Card>
            <CardHeader><CardTitle>Import GitHub Repo</CardTitle></CardHeader>
            <CardContent className="flex gap-2">
                <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="GitHub URL" />
                <Button onClick={handleImport} disabled={loading}>{loading ? <Loader2 className="animate-spin w-4 h-4 mr-2"/> : 'Import'}</Button>
            </CardContent>
        </Card>
        
        {simulations.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {simulations.map(sim => (
                    <Card key={sim.id} className="p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <Globe className="w-5 h-5 text-neutral-400"/>
                            <p className="font-semibold truncate w-40">{sim.repoUrl}</p>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => setActiveSim(sim)}><Play className="w-4 h-4"/></Button>
                            <Button size="sm" variant="destructive" onClick={() => saveToStorage(simulations.filter(s => s.id !== sim.id))}><Trash2 className="w-4 h-4"/></Button>
                        </div>
                    </Card>
                ))}
            </div>
        )}

        {activeSim && (
            <div className="mt-8 border rounded-lg h-[600px] w-full bg-white">
                <iframe src={activeSim.url} className="w-full h-full rounded-lg" title="Simulation" />
            </div>
        )}
    </div>
  );
}
