import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { Plus, Play, Info, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { motion } from 'motion/react';

interface Simulation {
  id: string;
  title: string;
  path: string;
}

export default function Home() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);

  const fetchSimulations = async () => {
    try {
      const res = await fetch(`/api/simulations?t=${Date.now()}`);
      const data = await res.json();
      setSimulations(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchSimulations();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('simulation', selectedFile);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Simulation uploaded and extracted');
        setOpen(false);
        fetchSimulations();
      } else {
        toast.error(data.error || 'Upload failed');
      }
    } catch (e) {
      toast.error('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Simulations</h1>
          <p className="text-neutral-500">Choose a simulation to start your learning journey.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchSimulations} title="Refresh list">
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="gap-2" />}>
              <Plus className="w-4 h-4" />
              Upload Simulation
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload New Simulation</DialogTitle>
                <DialogDescription>
                  Upload a ZIP file containing your simulation. 
                  <span className="block mt-2 font-medium text-emerald-600">
                    Supports static HTML or React/Vite source code (Auto-Build).
                  </span>
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpload} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select ZIP File</label>
                  <Input 
                    type="file" 
                    accept=".zip" 
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isUploading}>
                  {isUploading ? 'Building & Extracting...' : 'Upload Simulation'}
                </Button>
              </form>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-neutral-500">Or use a sample</span></div>
              </div>
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={async () => {
                  const res = await fetch('/api/create-sample', { method: 'POST' });
                  if (res.ok) {
                    toast.success('Sample simulation generated!');
                    setOpen(false);
                    fetchSimulations();
                  }
                }}
              >
                Generate Demo Simulation
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {simulations.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl">
            <Info className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No simulations found</h3>
            <p className="text-neutral-500 mb-6">Upload your first simulation to get started.</p>
          </div>
        ) : (
          simulations.map((sim, i) => (
            <motion.div
              key={sim.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="group hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="capitalize">{sim.title}</CardTitle>
                  <CardDescription>Interactive scientific model</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video bg-neutral-100 rounded-md flex items-center justify-center">
                    <Terminal className="w-12 h-12 text-neutral-300" />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full gap-2" nativeButton={false} render={<Link to={`/${sim.id}`} />}>
                    <Play className="w-4 h-4 fill-current" />
                    Start Simulation
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

function Terminal(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}
