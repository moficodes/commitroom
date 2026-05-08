/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Clock, 
  Send, 
  User, 
  CheckCircle2, 
  History, 
  X,
  Timer,
  AlertCircle,
  Hash,
  Zap,
  ZapOff,
  Terminal,
  Trophy
} from 'lucide-react';
import { formatDistanceToNow, addMinutes, isAfter, differenceInSeconds } from 'date-fns';
import { Commitment, TaskCategory, SessionType, CompletedCommitment } from './types';

const SOCKET_URL = window.location.origin;

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [username, setUsername] = useState<string>(() => localStorage.getItem('commit_username') || '');
  const [isSettingUsername, setIsSettingUsername] = useState(!username);
  const [taskInput, setTaskInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory>('Work');
  const [workMinutes, setWorkMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [sessionType, setSessionType] = useState<SessionType>('idle');
  const [pomosCompleted, setPomosCompleted] = useState(0);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CompletedCommitment[]>(() => {
    const saved = localStorage.getItem('commit_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [commits, setCommits] = useState<Commitment[]>([]);
  const [activeCommit, setActiveCommit] = useState<Commitment | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('commit_history', JSON.stringify(history));
  }, [history]);

  const playAlert = (type: 'finish' | 'start') => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'finish') {
        // Higher pitched double beep for finishing
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else {
        // Lower mellow beep for starting/breaks
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      console.error('Audio play failed', e);
    }
  };

  // Socket initialization
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      reconnectionAttempts: 5,
      timeout: 10000,
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setConnectionStatus('connected');
      setStatusMessage(null);
    });

    newSocket.on('disconnect', () => {
      setConnectionStatus('connecting');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection Error:', error);
      setConnectionStatus('error');
      setStatusMessage('Connection failed. Retrying...');
    });

    newSocket.on('initial:commits', (initialCommits: Commitment[]) => {
      setCommits(initialCommits);
    });

    newSocket.on('commit:broadcast', (newCommit: Commitment) => {
      setCommits(prev => [newCommit, ...prev].slice(0, 50));
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Timer logic
  useEffect(() => {
    if (activeCommit) {
      const endTime = addMinutes(new Date(activeCommit.timestamp), activeCommit.durationMinutes);
      
      const updateTimer = () => {
        const now = new Date();
        const diff = differenceInSeconds(endTime, now);
        if (diff <= 0) {
          setTimeLeft(0);
          if (timerRef.current) clearInterval(timerRef.current);
          setShowDoneDialog(true);
          playAlert('finish');
          
          // Trigger Notification
          if (Notification.permission === 'granted') {
            new Notification('Commit.io Notification', {
              body: sessionType === 'work' ? 'Work session complete! Check in now.' : 'Break time is over! Ready to focus?',
              icon: '/favicon.ico'
            });
          }
        } else {
          setTimeLeft(diff);
        }
      };

      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
    } else {
      setTimeLeft(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeCommit]);

  // Request Notification Permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  const handleSetUsername = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed) {
      localStorage.setItem('commit_username', trimmed);
      setIsSettingUsername(false);
      playAlert('start'); // Warm up AudioContext on first interaction
    }
  };

  const handleCommit = (e: FormEvent) => {
    e.preventDefault();
    if (!taskInput.trim() || !socket) return;
    
    if (connectionStatus !== 'connected') {
      setStatusMessage('Cannot broadcast while offline.');
      setTimeout(() => setStatusMessage(null), 3000);
      return;
    }

    const newCommit = {
      username,
      task: taskInput.trim(),
      category: selectedCategory,
      durationMinutes: workMinutes,
    };

    setStatusMessage('Broadcasting commitment...');
    
    try {
      socket.emit('commit:create', newCommit);
      setSessionType('work');
      playAlert('start');
      setActiveCommit({
        ...newCommit,
        id: 'local-' + Date.now(),
        timestamp: new Date().toISOString()
      });
      setTaskInput('');
      
      // Use a timeout to transition from "Broadcasting" to "Success"
      setTimeout(() => {
        setStatusMessage('Commitment broadcast successful.');
        setTimeout(() => setStatusMessage(null), 2500);
      }, 1000);
    } catch (err) {
      console.error('Broadcast failed:', err);
      setStatusMessage('Broadcast failed. Try again.');
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleStartBreak = () => {
    setStatusMessage(null); // Clear any pending broadcast toasts
    setSessionType('break');
    playAlert('start');
    setActiveCommit({
      id: 'break-' + Date.now(),
      username,
      task: 'Taking a well-deserved break',
      category: 'Other',
      durationMinutes: breakMinutes,
      timestamp: new Date().toISOString()
    });
    setShowDoneDialog(false);
  };

  const handleFinishSession = (completed: boolean) => {
    setStatusMessage(null); // Clear any pending toasts
    if (activeCommit && sessionType === 'work') {
      const historyItem: CompletedCommitment = {
        ...activeCommit,
        completedAt: new Date().toISOString(),
        isSuccess: completed
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 100));
      if (completed) {
        setPomosCompleted(prev => prev + 1);
      }
    }
    setSessionType('idle');
    setActiveCommit(null);
    setShowDoneDialog(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isSettingUsername) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border-4 border-black p-10 w-full max-w-md rounded-[2.5rem] shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
        >
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center text-white text-3xl font-black italic">C</div>
            <h1 className="text-3xl font-black tracking-tighter uppercase italic text-center leading-none">Initialize <br/>Commit.io</h1>
          </div>
          <form onSubmit={handleSetUsername} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-zinc-400 tracking-widest block text-center">Identity Required_</label>
              <input
                type="text"
                placeholder="Citizen Name..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-100 border-2 border-black p-4 rounded-2xl font-bold text-center focus:outline-none focus:ring-4 focus:ring-lime-400/30 transition-all text-xl"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-black text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 active:scale-95"
            >
              Enter Room <Send className="w-5 h-5 text-lime-400" />
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-500 font-sans p-6 overflow-hidden flex flex-col ${isFocusMode ? 'bg-zinc-900' : 'bg-zinc-50'}`}>
      {/* App Header */}
      <header className={`max-w-7xl mx-auto w-full flex justify-between items-center mb-8 shrink-0 transition-opacity duration-300 ${isFocusMode && !activeCommit ? 'opacity-20' : 'opacity-100'}`}>
        <div className={`flex items-center gap-3 transition-transform duration-500 ${isFocusMode ? 'scale-75 origin-left grayscale' : ''}`}>
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white font-black italic text-xl">C</div>
          <h1 className={`text-2xl md:text-3xl font-black tracking-tighter uppercase italic ${isFocusMode ? 'text-white' : 'text-zinc-900'}`}>Commit.io</h1>
        </div>
        <div className="flex gap-4 items-center">
          {!isFocusMode && (
            <>
              <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 border-2 border-black rounded-full text-[10px] font-black uppercase tracking-tighter shadow-[2px_2px_0px_0px_#000000] ${
                connectionStatus === 'connected' ? 'bg-green-100 text-green-700' : 
                connectionStatus === 'connecting' ? 'bg-amber-100 text-amber-700 animate-pulse' : 
                'bg-red-100 text-red-700'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-600' : 
                  connectionStatus === 'connecting' ? 'bg-amber-600' : 
                  'bg-red-600'
                }`} />
                {connectionStatus === 'connected' ? 'Live_Sync' : connectionStatus === 'connecting' ? 'Linking...' : 'Offline'}
              </div>
              <div className="hidden sm:flex items-center gap-4 bg-white border-2 border-black rounded-xl p-1 shadow-[2px_2px_0px_0px_#000000]">
                <div className="flex flex-col items-center px-3 border-r-2 border-black/10">
                  <span className="text-[8px] font-black uppercase text-zinc-400">Work</span>
                  <input 
                    type="number" 
                    value={workMinutes} 
                    onChange={(e) => setWorkMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={!!activeCommit}
                    className="w-8 text-xs font-black text-center focus:outline-none disabled:opacity-50"
                  />
                </div>
                <div className="flex flex-col items-center px-3">
                  <span className="text-[8px] font-black uppercase text-zinc-400">Break</span>
                  <input 
                    type="number" 
                    value={breakMinutes} 
                    onChange={(e) => setBreakMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                    disabled={!!activeCommit}
                    className="w-8 text-xs font-black text-center focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>
            </>
          )}

          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`flex items-center gap-2 px-4 py-2 border-2 border-black rounded-full text-xs font-black uppercase tracking-widest transition-all shadow-[4px_4px_0px_0px_#000000] active:translate-x-1 active:translate-y-1 active:shadow-none ${
              isFocusMode 
                ? 'bg-lime-400 text-black' 
                : 'bg-white text-black hover:bg-lime-100'
            }`}
          >
            {isFocusMode ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
            <span className="hidden md:inline">{isFocusMode ? 'Normal_Mode' : 'Focus_Mode'}</span>
          </button>

          {!isFocusMode && (
            <>
              <button 
                onClick={() => setShowHistory(true)}
                className="w-10 h-10 border-2 border-black rounded-xl flex items-center justify-center bg-white hover:bg-zinc-100 transition-colors shadow-[2px_2px_0px_0px_#000000]"
              >
                <History className="w-5 h-5" />
              </button>
              <div className="hidden sm:flex items-center gap-2 font-black uppercase text-xs px-4 py-2 bg-white border-2 border-black rounded-full shadow-[4px_4px_0px_0px_#000000]">
                <User className="w-3 h-3" /> {username}
              </div>
              <span className="text-xs font-black px-4 py-2 bg-zinc-200 border-2 border-black rounded-full uppercase tracking-tighter">
                {commits.length} Online
              </span>
              <button 
                onClick={() => setIsSettingUsername(true)}
                className="w-10 h-10 border-2 border-black rounded-xl flex items-center justify-center hover:bg-red-50 transition-colors"
              >
                <AlertCircle className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className={`max-w-7xl mx-auto w-full flex-grow grid grid-cols-12 grid-rows-6 gap-6 min-h-0 pb-6 transition-all duration-700 ${isFocusMode ? 'overflow-visible' : 'overflow-hidden'}`}>
        
        {/* Live Commitment Feed (Left Column) */}
        <AnimatePresence>
          {!isFocusMode && (
            <motion.div 
              initial={{ opacity: 0, x: -100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100, scale: 0.9 }}
              className="col-span-12 lg:col-span-7 row-span-6 lg:row-span-5 bg-white border-4 border-black rounded-[2.5rem] p-8 flex flex-col shadow-[8px_8px_0px_0px_#000000] overflow-hidden"
            >
              <div className="flex justify-between items-center mb-6 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <h2 className="text-xl font-black uppercase tracking-tight">The Public Square</h2>
                </div>
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest whitespace-nowrap">LIVE_FEED • {commits.length <= 9 ? `0${commits.length}` : commits.length}_SYNDICATED</span>
              </div>
              
              <div className="flex-grow overflow-y-auto space-y-6 pr-2 scrollbar-hide">
                <AnimatePresence initial={false}>
                  {commits.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 italic font-mono space-y-2">
                      <Terminal className="w-8 h-8" />
                      <p className="text-sm uppercase font-bold tracking-widest">Waiting for initial transmission...</p>
                    </div>
                  ) : (
                    commits.map((commit) => (
                      <motion.div 
                        key={commit.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex gap-4 items-start pb-6 border-b border-zinc-100 last:border-0"
                      >
                        <div className={`w-12 h-12 rounded-full border-2 border-black shrink-0 shadow-[2px_2px_0px_0px_#000000] ${
                          commit.username.length % 4 === 0 ? 'bg-lime-400' : 
                          commit.username.length % 4 === 1 ? 'bg-blue-400' :
                          commit.username.length % 4 === 2 ? 'bg-orange-400' : 'bg-purple-400'
                        }`} />
                        <div className="flex-grow">
                          <div className="flex items-center justify-between mb-1">
                            <p className="font-black text-sm uppercase flex items-center gap-2">
                              {commit.username} 
                              <span className="text-zinc-400 font-bold normal-case text-xs underline decoration-2">{formatDistanceToNow(new Date(commit.timestamp), { addSuffix: true })}</span>
                            </p>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 border border-black rounded shadow-[2px_2px_0px_0px_#000000] ${
                              commit.category === 'Work' ? 'bg-zinc-100 text-zinc-900' :
                              commit.category === 'Code' ? 'bg-blue-400 text-black' :
                              commit.category === 'Design' ? 'bg-purple-400 text-black' :
                              commit.category === 'Study' ? 'bg-amber-400 text-black' : 'bg-lime-400 text-black'
                            }`}>
                              {commit.category}
                            </span>
                          </div>
                          <p className="text-xl leading-tight mt-1 italic font-medium tracking-tight">
                            "I am working on {commit.task} for the next {commit.durationMinutes} minutes."
                          </p>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timer / Active Session (Right Top or Center) */}
        <motion.div 
          layout
          className={`bg-zinc-900 text-white rounded-[2.5rem] p-8 border-4 border-black flex flex-col justify-between shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)] transition-all overflow-hidden relative ${
            isFocusMode 
              ? 'col-span-12 row-span-6 lg:col-span-8 lg:col-start-3 shadow-[24px_24px_0px_0px_rgba(0,0,0,0.5)] border-white/20' 
              : 'col-span-12 lg:col-span-5 row-span-3'
          }`}
        >
          <AnimatePresence mode="wait">
            {activeCommit ? (
              <motion.div 
                key="active-session"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col justify-between"
              >
                <div className="flex justify-between items-start">
                  <span className={`px-4 py-1.5 text-black text-xs font-black rounded-full uppercase italic tracking-widest border border-white ${
                    sessionType === 'work' ? 'bg-lime-400' : 'bg-blue-400'
                  }`}>
                    {sessionType === 'work' ? 'Active Session_' : 'Break Protocol_'}
                  </span>
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Timer className={`w-6 h-6 animate-pulse ${
                      sessionType === 'work' ? 'text-lime-400' : 'text-blue-400'
                    }`} />
                  </div>
                </div>
                
                <div className="text-center py-4">
                  <motion.div 
                    layout
                    className={`font-black tracking-tighter tabular-nums mb-2 leading-none transition-all duration-700 ${
                      isFocusMode ? 'text-[12rem] lg:text-[16rem]' : 'text-7xl md:text-8xl'
                    }`}
                  >
                    {formatTime(timeLeft)}
                  </motion.div>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-zinc-500 text-xs font-black uppercase tracking-widest">
                      {sessionType === 'work' ? 'Protocol Identification_' : 'Rest Synchronization_'}
                    </p>
                    <p className={`${sessionType === 'work' ? 'text-lime-200' : 'text-blue-200'} font-bold italic line-clamp-1 transition-all duration-700 ${
                      isFocusMode ? 'text-3xl' : 'text-lg'
                    }`}>
                      "{activeCommit.task}"
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Synchronization Status_</span>
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                      sessionType === 'work' ? 'text-lime-400' : 'text-blue-400'
                    }`}>
                      {Math.round((timeLeft / (activeCommit.durationMinutes * 60)) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-zinc-800 h-4 border border-zinc-700 rounded-full overflow-hidden">
                    <motion.div 
                      className={sessionType === 'work' ? 'bg-lime-400' : 'bg-blue-400'}
                      initial={{ width: '100%' }}
                      animate={{ width: `${(timeLeft / (activeCommit.durationMinutes * 60)) * 100}%` }}
                      transition={{ ease: "linear", duration: 1 }}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40 grayscale italic">
                <Timer className="w-16 h-16" />
                <p className="text-xl font-black uppercase tracking-tighter">System Idle_<br/><span className="text-sm font-bold opacity-50">Initiate Commitment via Command Bar</span></p>
              </div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Statistics Card (Right Bottom Left) */}
        {!isFocusMode && (
          <>
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden lg:flex col-span-3 row-span-2 bg-lime-400 rounded-[2.5rem] p-6 border-4 border-black flex-col justify-center shadow-[8px_8px_0px_0px_#000000] relative overflow-hidden group"
            >
              <div className="absolute top-4 right-4 bg-black/10 w-8 h-8 rounded-full flex items-center justify-center">
                <Trophy className="w-4 h-4" />
              </div>
              <p className="text-xs font-black uppercase text-black/60 mb-1 tracking-widest leading-none">Pomos Completed_</p>
              <div className="flex items-baseline gap-2">
                <p className="text-5xl font-black italic tracking-tighter leading-none">{pomosCompleted}</p>
                <p className="text-xl font-bold uppercase tracking-tighter">Units</p>
              </div>
              <div className="mt-6 flex gap-1.5">
                {[1, 1, 1, 1, 0].map((v, i) => (
                  <div key={i} className={`w-3 h-3 rounded-full border border-black/20 ${v ? 'bg-black' : 'bg-black/10'}`} />
                ))}
              </div>
            </motion.div>

            {/* Rank Card (Right Bottom Right) */}
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden lg:flex col-span-2 row-span-2 bg-white rounded-[2.5rem] border-4 border-black p-6 flex-col items-center justify-center shadow-[8px_8px_0px_0px_#000000] group hover:bg-zinc-50 transition-colors"
            >
              <p className="text-xs font-black uppercase text-zinc-400 mb-2 tracking-[0.2em]">Global_Rank</p>
              <div className="relative">
                <div className="text-5xl font-black italic tracking-tighter">#04</div>
                <motion.div 
                  animate={{ y: [0, -3, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute -top-1 -right-4 w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center rounded-full font-black"
                >
                  ↑
                </motion.div>
              </div>
            </motion.div>

            {/* Commitment Input Bar (Full Width Bottom) */}
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              className="col-span-12 row-span-1 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 px-2">
                {(['Work', 'Code', 'Design', 'Study', 'Other'] as TaskCategory[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    disabled={!!activeCommit}
                    className={`text-[10px] font-black uppercase px-3 py-1 border-2 border-black rounded-lg transition-all ${
                      selectedCategory === cat 
                        ? 'bg-lime-400 translate-y-[-2px] shadow-[4px_4px_0px_0px_#000000]' 
                        : 'bg-white hover:bg-zinc-100 opacity-50 grayscale hover:grayscale-0'
                    } disabled:opacity-20`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <form 
                onSubmit={handleCommit}
                className="w-full bg-black rounded-[2rem] border-4 border-zinc-800 flex items-center px-8 gap-4 shadow-[0px_12px_24px_rgba(0,0,0,0.4)] h-20 overflow-hidden shrink-0"
              >
                <span className="text-zinc-500 font-bold italic hidden xl:block whitespace-nowrap">I am working on...</span>
                <input 
                  type="text" 
                  placeholder="Execute next objective..." 
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  disabled={!!activeCommit}
                  className="bg-transparent text-white font-bold border-none focus:ring-0 placeholder-zinc-700 flex-grow text-xl italic tracking-tight h-full disabled:opacity-20"
                />
                <span className="text-zinc-500 font-bold italic hidden xl:block whitespace-nowrap">for the next {workMinutes} minutes.</span>
                <button 
                  type="submit"
                  disabled={!taskInput.trim() || !!activeCommit}
                  className="bg-lime-400 hover:bg-lime-300 transition-all text-black px-10 py-3 rounded-2xl font-black uppercase tracking-tight text-sm border-2 border-white active:scale-95 disabled:opacity-20 disabled:grayscale disabled:hover:scale-100"
                >
                  {activeCommit ? 'Locked_In' : 'Commit Now'}
                </button>
              </form>
            </motion.div>
          </>
        )}

      </main>

      {/* Done Dialog */}
      <AnimatePresence>
        {showDoneDialog && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-zinc-950/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.8, y: 40 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white border-4 border-black p-10 max-w-lg w-full rounded-[3rem] shadow-[24px_24px_0px_0px_#000000] text-center"
            >
              <div className="flex justify-center mb-8">
                <div className="w-24 h-24 bg-lime-400 border-4 border-black flex items-center justify-center rounded-3xl animate-bounce shadow-[4px_4px_0px_0px_#000000]">
                  <Trophy className="text-black w-12 h-12" />
                </div>
              </div>
              
              <h2 className="text-5xl font-black uppercase mb-4 italic tracking-tighter leading-none">
                {sessionType === 'work' ? 'Commitment' : 'Rest Phase'}<br/>
                Complete?
              </h2>
              
              <div className="bg-zinc-100 p-6 rounded-3xl border-2 border-black/10 mb-10">
                <p className="text-xs font-black uppercase text-zinc-400 mb-2 tracking-widest">
                  {sessionType === 'work' ? 'Protocol Requirement_' : 'Rest Protocol_'}
                </p>
                <p className="text-2xl font-bold italic tracking-tight">"{activeCommit?.task}"</p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <motion.button 
                    whileHover={{ 
                      scale: 1.02,
                      x: -2,
                      y: -2,
                      boxShadow: "10px 10px 0px 0px #000000"
                    }}
                    whileTap={{ 
                      scale: 0.98,
                      x: 2,
                      y: 2,
                      boxShadow: "2px 2px 0px 0px #000000"
                    }}
                    onClick={() => handleFinishSession(true)}
                    className="bg-black text-white py-5 rounded-[2rem] font-black uppercase tracking-widest hover:bg-lime-400 hover:text-black transition-colors flex items-center justify-center gap-2 group relative overflow-hidden shadow-[6px_6px_0px_0px_#000000]"
                  >
                    <motion.div
                      whileHover={{ rotate: [0, -10, 10, -10, 0] }}
                      transition={{ duration: 0.5 }}
                    >
                      <CheckCircle2 className="w-6 h-6" />
                    </motion.div>
                    <span>Fulfill</span>
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleFinishSession(false)}
                    className="bg-white border-4 border-black text-black py-5 rounded-[2rem] font-black uppercase tracking-widest hover:bg-red-50 transition-all shadow-[6px_6px_0px_0px_#000000]"
                  >
                    Abandon
                  </motion.button>
                </div>

                {sessionType === 'work' && (
                  <button 
                    onClick={handleStartBreak}
                    className="w-full bg-blue-400 text-black py-4 rounded-[2rem] font-black uppercase tracking-widest border-4 border-black hover:bg-blue-300 transition-all shadow-[6px_6px_0px_0px_#000000]"
                  >
                    Initiate Break Strategy
                  </button>
                )}
              </div>
              
              <p className="mt-8 text-[10px] uppercase font-black text-zinc-400 italic tracking-[0.3em]">Decision Permanence Verified_</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!isFocusMode && (
          <motion.footer 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="max-w-7xl mx-auto w-full p-6 mt-auto flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 transition-opacity"
          >
            <div className="font-black text-[10px] uppercase tracking-[0.2em] italic">
              Designed for Ultra-Focus Performance_
            </div>
            <div className="flex items-center gap-6 font-black text-[10px] uppercase tracking-tighter">
              <div className="flex items-center gap-2 text-green-600">
                <div className="w-1.5 h-1.5 bg-current rounded-full" /> Latency: Low_
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-current rounded-full" /> Security: High_
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-current rounded-full" /> Status: Synchronized_
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {statusMessage && <StatusToast message={statusMessage} />}
      </AnimatePresence>

      <HistoryModal 
        isOpen={showHistory} 
        onClose={() => setShowHistory(false)} 
        history={history}
        onClear={() => setHistory([])}
      />
    </div>
  );
}

const HistoryModal = ({ 
  isOpen, 
  onClose, 
  history,
  onClear
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  history: CompletedCommitment[];
  onClear: () => void;
}) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-zinc-950/80 backdrop-blur-md"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="bg-white border-4 border-black w-full max-w-2xl max-h-[80vh] rounded-[2.5rem] shadow-[24px_24px_0px_0px_#000000] flex flex-col overflow-hidden"
        >
          <div className="p-8 border-b-4 border-black flex items-center justify-between bg-zinc-50">
            <div className="flex items-center gap-3">
              <History className="w-8 h-8" />
              <h2 className="text-3xl font-black uppercase italic tracking-tighter">Mission Log_</h2>
            </div>
            <div className="flex items-center gap-4">
              {history.length > 0 && (
                <button 
                  onClick={onClear}
                  className="text-[10px] font-black uppercase bg-red-100 text-red-600 px-3 py-1 border-2 border-red-600 rounded-lg hover:bg-red-200 transition-colors"
                >
                  Clear Log
                </button>
              )}
              <button 
                onClick={onClose}
                className="w-10 h-10 border-2 border-black rounded-xl flex items-center justify-center hover:bg-zinc-200 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-grow overflow-y-auto p-8 space-y-4 scrollbar-hide">
            {history.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-zinc-400 italic">
                <Terminal className="w-12 h-12 mb-2 opacity-20" />
                <p className="font-black uppercase text-xs tracking-widest">No previous telemetry data found_</p>
              </div>
            ) : (
              history.map((item, idx) => (
                <div 
                  key={idx}
                  className={`p-6 border-2 border-black rounded-3xl transition-transform hover:translate-x-1 ${
                    item.isSuccess ? 'bg-zinc-50' : 'bg-red-50/30'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 border border-black rounded shadow-[2px_2px_0px_0px_#000000] ${
                        item.category === 'Work' ? 'bg-zinc-100 text-zinc-900' :
                        item.category === 'Code' ? 'bg-blue-400 text-black' :
                        item.category === 'Design' ? 'bg-purple-400 text-black' :
                        item.category === 'Study' ? 'bg-amber-400 text-black' : 'bg-lime-400 text-black'
                      }`}>
                        {item.category}
                      </span>
                      {item.isSuccess ? (
                        <span className="text-[10px] font-black uppercase text-lime-600 bg-lime-50 px-2 py-0.5 rounded border border-lime-600">Fulfilled</span>
                      ) : (
                        <span className="text-[10px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-600">Abandoned</span>
                      )}
                    </div>
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      {new Date(item.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(item.completedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xl font-bold italic tracking-tight line-clamp-1">"{item.task}"</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase text-zinc-400 italic">
                    <span>Duration: {item.durationMinutes}m</span>
                    <span>Status: {item.isSuccess ? 'Verified_' : 'Terminated_'}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-6 bg-zinc-900 border-t-4 border-black text-white/40 flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] italic">
            <span>Total Units Logged: {history.filter(h => h.isSuccess).length}</span>
            <span>Historical Persistence Enabled_</span>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const StatusToast = ({ message }: { message: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 50 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 50 }}
    className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100]"
  >
    <div className="bg-black text-white px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest border-2 border-lime-400 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.5)] flex items-center gap-3">
      <div className="w-2 h-2 bg-lime-400 rounded-full animate-ping" />
      {message}
    </div>
  </motion.div>
);

