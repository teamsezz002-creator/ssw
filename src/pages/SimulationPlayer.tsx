import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { ChevronLeft, Maximize2, RotateCcw, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';

export default function SimulationPlayer() {
  const { simId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [simId, iframeKey]);

  if (!simId || !user) return null;

  const simUrl = `/api/simRender/${simId}/index.html?userId=${user.uid}&simId=${simId}`;

  const toggleFullscreen = () => {
    if (iframeRef.current) {
      try {
        if (iframeRef.current.requestFullscreen) {
          iframeRef.current.requestFullscreen();
        }
      } catch (err) {
        console.error("Fullscreen failed:", err);
      }
    }
  };

  const handleRestart = () => {
    setIframeKey(prev => prev + 1);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
          <h2 className="text-xl font-bold capitalize">{simId.replace(/-/g, ' ')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRestart}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Restart
          </Button>
          <Button variant="outline" size="sm" onClick={toggleFullscreen}>
            <Maximize2 className="w-4 h-4 mr-2" />
            Fullscreen
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={async () => {
              if (confirm(`Are you sure you want to delete ${simId.replace(/-/g, ' ')}?`)) {
                try {
                   const res = await fetch(`/api/delete-simulation/${encodeURIComponent(simId)}`, { method: 'POST' });
                   if (res.ok) {
                       toast.success('Simulation deleted');
                       navigate('/');
                   } else {
                       const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                       toast.error(errorData.error || 'Failed to delete simulation');
                   }
                } catch (e) {
                   toast.error('Failed to delete simulation due to connection error');
                }
              }
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border shadow-sm overflow-hidden relative min-h-[400px]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-50 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-neutral-500 font-medium">Loading Simulation...</p>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-20">
            <div className="max-w-md text-center p-6 bg-white rounded-xl shadow-xl border border-red-100">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <RotateCcw className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-red-900 mb-2">Simulation Failed to Load</h3>
              <p className="text-sm text-red-700 mb-6">{error}</p>
              <Button onClick={handleRestart} variant="destructive" className="w-full">
                Try Again
              </Button>
            </div>
          </div>
        )}

        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={simUrl}
          className="w-full h-full border-none"
          title={`Simulation ${simId}`}
          onLoad={() => {
            setLoading(false);
            // Check if it's blank or 404
            try {
               const content = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
               if (content && (content.title === "404" || content.body?.innerHTML.length === 0)) {
                 // Might not work due to origin cross check, but usually the sim is on same origin
               }
            } catch(e) {}
          }}
          onError={() => setError("The simulation could not be loaded. Please check the upload integrity.")}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; bluetooth; usb; serial"
          allowFullScreen
        />
      </div>

      <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100 flex items-start gap-3">
        <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">!</div>
        <div className="text-sm text-blue-900">
          <p className="font-semibold">Tracking Active</p>
          <p className="opacity-80">This simulation is being tracked for learning progress. All actions are logged to your profile.</p>
        </div>
      </div>
    </div>
  );
}
