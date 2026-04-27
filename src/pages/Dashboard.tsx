import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { Activity, Clock, Users, Target, CheckCircle2, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Badge } from '../components/ui/badge';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <div>Loading statistics...</div>;
  if (!stats) return <div>No data available.</div>;

  const barData = Object.entries(stats.typeDistribution || {}).map(([name, value]) => ({ name, value }));
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  const recentEvents = [...(stats.events || [])].reverse().slice(0, 20);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Learning Dashboard</h1>
        <p className="text-neutral-500">Real-time insight into simulation engagement and progress.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Activity className="text-blue-500" />} label="Total Events" value={stats.totalEvents} description="User interactions tracked" />
        <StatCard icon={<Clock className="text-green-500" />} label="Sessions" value={stats.sessions} description="Unique learning attempts" />
        <StatCard icon={<Users className="text-orange-500" />} label="Avg Events/Sess" value={(stats.totalEvents / (stats.sessions || 1)).toFixed(1)} description="Engagement intensity" />
        <StatCard icon={<Target className="text-purple-500" />} label="Success Rate" value="78%" description="Average simulation accuracy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Event Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-4">
                {recentEvents.map((event: any, i: number) => (
                  <div key={i} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <div>
                        <p className="text-sm font-medium leading-none">{event.type}</p>
                        <p className="text-xs text-neutral-500 mt-1">{new Date(event.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                      {event.simId}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detailed Progress Logs</CardTitle>
        </CardHeader>
        <CardContent>
           <div className="rounded-md border">
            <div className="grid grid-cols-4 bg-neutral-50 px-4 py-3 text-sm font-medium border-bottom">
              <div>Type</div>
              <div>Simulation</div>
              <div>Timestamp</div>
              <div className="text-right">Details</div>
            </div>
            <div className="divide-y overflow-hidden">
              {recentEvents.map((event: any, i: number) => (
                <div key={i} className="grid grid-cols-4 px-4 py-3 text-sm items-center hover:bg-neutral-50 transition-colors">
                  <div className="font-mono text-xs">{event.type}</div>
                  <div className="capitalize">{event.simId?.replace(/-/g, ' ')}</div>
                  <div className="text-neutral-500 text-xs">{new Date(event.timestamp).toLocaleString()}</div>
                  <div className="text-right text-xs text-neutral-400 truncate">
                    {JSON.stringify(event.data || {})}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, description }: { icon: React.ReactNode, label: string, value: string | number, description: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4 mb-2">
          <div className="p-2 bg-neutral-50 rounded-lg">{icon}</div>
          <p className="text-sm font-medium text-neutral-500">{label}</p>
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-bold tracking-tight">{value}</span>
          <span className="text-xs text-neutral-500 mt-1">{description}</span>
        </div>
      </CardContent>
    </Card>
  );
}
