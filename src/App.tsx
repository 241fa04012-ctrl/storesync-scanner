import React, { useState, useEffect, useCallback } from 'react';
import { 
  Scan, 
  History, 
  Settings, 
  Camera, 
  Image as ImageIcon, 
  Copy, 
  Trash2, 
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface ScanRecord {
  id: string;
  data: string;
  type: string;
  format: string;
  timestamp: number;
  synced?: boolean;
}

interface SyncSettings {
  storeSyncUrl: string;
  autoSync: boolean;
  method: 'POST' | 'REDIRECT';
}

// --- Persistence Hooks ---
const STORAGE_KEY = 'scan_master_history';
const SETTINGS_KEY = 'scan_master_settings';

function useSyncSettings() {
  const [settings, setSettings] = useState<SyncSettings>({
    storeSyncUrl: '',
    autoSync: false,
    method: 'POST'
  });

  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse settings');
      }
    }
  }, []);

  const updateSettings = (newSettings: SyncSettings) => {
    setSettings(newSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  };

  return { settings, updateSettings };
}

function useScanHistory() {
  const [history, setHistory] = useState<ScanRecord[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  const addRecord = (data: string, type: string, format: string) => {
    const newRecord: ScanRecord = {
      id: crypto.randomUUID(),
      data,
      type,
      format,
      timestamp: Date.now(),
    };
    const updated = [newRecord, ...history].slice(0, 50); // Keep last 50
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return newRecord;
  };

  const markSynced = (id: string) => {
    const updated = history.map(r => r.id === id ? { ...r, synced: true } : r);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const deleteRecord = (id: string) => {
    const updated = history.filter(r => r.id !== id);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  return { history, addRecord, clearHistory, deleteRecord, markSynced };
}

// --- Components ---

export default function App() {
  const [lastResult, setLastResult] = useState<ScanRecord | null>(null);
  const { history, addRecord, clearHistory, deleteRecord, markSynced } = useScanHistory();
  const { settings, updateSettings } = useSyncSettings();
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const syncToStoreSync = async (record: ScanRecord) => {
    if (!settings.storeSyncUrl) {
      setError("Please configure Store Sync URL in Settings.");
      setIsSettingsOpen(true);
      return false;
    }

    try {
      if (settings.method === 'REDIRECT') {
        const url = new URL(settings.storeSyncUrl);
        url.searchParams.append('code', record.data);
        url.searchParams.append('format', record.format);
        window.open(url.toString(), '_blank');
        markSynced(record.id);
        return true;
      } else {
        // Assume Webhook POST
        const response = await fetch(settings.storeSyncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: record.data,
            format: record.format,
            timestamp: record.timestamp,
            source: 'ScanMaster-VisionPro'
          })
        });
        
        if (response.ok) {
          markSynced(record.id);
          return true;
        } else {
          throw new Error('Sync failed');
        }
      }
    } catch (err) {
      setError("Store Sync failed. Check URL or network.");
      return false;
    }
  };

  const handleScanSuccess = async (decodedText: string, decodedResult: any) => {
    const format = decodedResult.result.format.formatName;
    const type = decodedText.startsWith('http') ? 'URL' : 'TEXT';
    const record = addRecord(decodedText, type, format);
    
    if (settings.autoSync) {
      await syncToStoreSync(record);
    }
    
    setLastResult(record);
    setScanning(false);
    stopScanner();
  };

  const stopScanner = async () => {
    try {
      const html5QrCode = new Html5Qrcode("reader");
      if (html5QrCode.getState() === Html5QrcodeScannerState.SCANNING) {
        await html5QrCode.stop();
      }
      setCameraActive(false);
      setScanning(false);
    } catch (err) {
      // Ignore
    }
  };

  const startScanner = async () => {
    setError(null);
    setCameraActive(true);
    setScanning(true);
    const html5QrCode = new Html5Qrcode("reader");
    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        handleScanSuccess,
        () => {}
      );
    } catch (err) {
      setError("Unable to access camera. Check permissions.");
      setCameraActive(false);
      setScanning(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const html5QrCode = new Html5Qrcode("reader");
    try {
      const result = await html5QrCode.scanFileV2(file, true);
      handleScanSuccess(result.decodedText, result);
    } catch (err) {
      setError("Could not find a valid code in this image.");
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center">
            <Scan className="w-5 h-5 text-slate-950" />
          </div>
          <h1 className="text-xl font-bold tracking-tight uppercase">Store<span className="text-emerald-500">Sync</span> Scanner</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className={cn("w-2 h-2 rounded-full", cameraActive ? "bg-emerald-500 animate-pulse" : "bg-slate-600")}></span>
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {cameraActive ? "Sensor Live" : "System Ready"}
            </span>
          </div>
          <div className="w-px h-6 bg-slate-800"></div>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="text-xs font-bold uppercase hover:text-emerald-400 transition-colors"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: Scanner Viewport */}
        <section className="flex-1 p-8 border-r border-slate-800 flex flex-col items-center justify-center relative bg-slate-950">
          <div className="scanner-viewport group">
            {/* Viewfinder Brackets */}
            <div className="bracket top-6 left-6 border-t-4 border-l-4" />
            <div className="bracket top-6 right-6 border-t-4 border-r-4" />
            <div className="bracket bottom-6 left-6 border-b-4 border-l-4" />
            <div className="bracket bottom-6 right-6 border-b-4 border-r-4" />
            
            <div id="reader" className="w-full h-full" />

            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 z-20 transition-opacity">
                <Camera className="w-20 h-20 text-slate-700 mb-4" strokeWidth={1.5} />
                <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">Waiting for sensor input</p>
              </div>
            )}

            {scanning && (
              <div className="scanner-line">
                <div className="scanner-line-bar animate-scan-line" />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mt-10 flex gap-4 w-full max-w-lg">
            <button 
              onClick={cameraActive ? stopScanner : startScanner}
              className="hw-button hw-button-primary"
            >
              <Camera className="w-5 h-5" />
              {cameraActive ? 'STOP CAMERA' : 'START CAMERA'}
            </button>
            <label className="hw-button hw-button-secondary cursor-pointer">
              <ImageIcon className="w-5 h-5" />
              UPLOAD IMAGE
              <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </label>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono rounded flex items-center gap-2"
            >
              <Info className="w-4 h-4" />
              {error}
            </motion.div>
          )}
        </section>

        {/* Right: History & Repository */}
        <section className="w-full md:w-1/3 bg-slate-900/30 flex flex-col border-t md:border-t-0 border-slate-800">
          <div className="p-6 border-b border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-500 mb-1">Scan Repository</h2>
            <p className="text-sm text-slate-400">Synchronized with Local DB</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {history.length === 0 ? (
              <div className="py-12 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-lg">
                NO SCAN RECORDS FOUND
              </div>
            ) : (
              history.map((record: ScanRecord) => (
                <HistoryItem 
                  key={record.id} 
                  record={record} 
                  onDelete={deleteRecord}
                  onSelect={() => setLastResult(record)}
                  onSync={() => syncToStoreSync(record)}
                />
              ))
            )}
          </div>

          {/* Footer Status */}
          <div className="p-4 bg-slate-900 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] uppercase text-slate-400">Storage Online</span>
              </div>
              {history.length > 0 && (
                <button 
                  onClick={clearHistory}
                  className="text-[10px] uppercase font-bold text-red-500 hover:text-red-400 transition-colors"
                >
                  Purge Data
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Bar Info */}
      <footer className="h-10 bg-emerald-500 text-slate-950 px-8 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider shrink-0">
        <span>Engine: Html5-Qrcode / ZXing Hook</span>
        <span className="hidden sm:inline">Connected to Local-Data-01</span>
        <span>Session ID: WS-{Math.floor(Math.random() * 9999)}-PX</span>
      </footer>

      {/* Result Overlay */}
      <AnimatePresence>
        {lastResult && (
          <ResultModal 
            record={lastResult} 
            onClose={() => setLastResult(null)} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal 
            settings={settings} 
            onUpdate={updateSettings} 
            onClose={() => setIsSettingsOpen(false)} 
          />
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.2);
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}

const HistoryItem: React.FC<{ 
  record: ScanRecord;
  onDelete: (id: string) => void;
  onSelect: () => void;
  onSync?: () => void;
}> = ({ record, onDelete, onSelect, onSync }) => {
  const isUrl = record.type === 'URL';
  
  return (
    <motion.div 
      layout
      className="history-card"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className={cn(
            "badge",
            isUrl ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-400"
          )}>
            {isUrl ? 'QR Link' : 'Barcode'}
          </span>
          {record.synced && (
            <span className="badge bg-emerald-500/10 text-emerald-500 flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" />
              Synced
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
      </div>
      <p className="text-sm font-mono truncate text-slate-200 mb-3" title={record.data}>
        {record.data}
      </p>
      <div className="flex gap-3">
        <button 
          onClick={onSelect}
          className="text-[10px] uppercase font-bold text-slate-400 hover:text-white transition-colors"
        >
          Inspect
        </button>
        {onSync && !record.synced && (
          <button 
            onClick={onSync}
            className="text-[10px] uppercase font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            Sync
          </button>
        )}
        <button 
          onClick={() => onDelete(record.id)}
          className="text-[10px] uppercase font-bold text-slate-500 hover:text-red-400 transition-colors"
        >
          Delete
        </button>
      </div>
    </motion.div>
  );
}

const ResultModal: React.FC<{ 
  record: ScanRecord; 
  onClose: () => void;
  onSync?: (r: ScanRecord) => Promise<boolean>;
}> = ({ record, onClose, onSync }) => {
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(record.data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSync = async () => {
    if (!onSync) return;
    setSyncing(true);
    await onSync(record);
    setSyncing(false);
  };

  const isUrl = record.type === 'URL';

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-lg p-8 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.5)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded flex items-center justify-center">
              <Scan className="w-5 h-5 text-slate-950" />
            </div>
            <h2 className="text-xl font-bold uppercase tracking-tight">Decryption <span className="text-emerald-500">Result</span></h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-950/50 rounded border border-slate-800 p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <span className="badge bg-emerald-500/10 text-emerald-500">{record.format}</span>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{record.type}</span>
          </div>
          <p className="text-slate-200 text-lg font-mono break-all leading-relaxed">
            {record.data}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <button 
            onClick={handleCopy}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-4 rounded flex items-center justify-center gap-2 transition-all uppercase text-xs"
          >
            {copied ? <ShieldCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'COPIED' : 'COPY'}
          </button>
          
          <button 
            disabled={syncing || record.synced}
            onClick={handleSync}
            className={cn(
              "flex-1 font-bold py-4 rounded flex items-center justify-center gap-2 transition-all uppercase text-xs",
              record.synced ? "bg-slate-800 text-emerald-500" : "bg-emerald-600/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20"
            )}
          >
            <Zap className={cn("w-4 h-4", syncing && "animate-spin")} />
            {record.synced ? 'SYNCED' : (syncing ? 'SYNCING...' : 'TO STORE SYNC')}
          </button>
        </div>
        
        {isUrl && (
          <a 
            href={record.data} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded border border-slate-700 flex items-center justify-center gap-2 transition-all uppercase text-xs"
          >
            <ExternalLink className="w-4 h-4" />
            LAUNCH URL
          </a>
        )}

        <button 
          onClick={onClose}
          className="w-full text-slate-500 text-[10px] font-bold mt-6 hover:text-slate-300 uppercase tracking-[0.2em] transition-colors"
        >
          Return to Hub
        </button>
      </motion.div>
    </motion.div>
  );
}

const SettingsModal: React.FC<{ 
  settings: SyncSettings; 
  onUpdate: (s: SyncSettings) => void;
  onClose: () => void;
}> = ({ settings, onUpdate, onClose }) => {
  const [localUrl, setLocalUrl] = useState(settings.storeSyncUrl);

  const handleSave = () => {
    onUpdate({ ...settings, storeSyncUrl: localUrl });
    onClose();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg p-8 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center">
            <Settings className="w-5 h-5 text-slate-400" />
          </div>
          <h2 className="text-xl font-bold uppercase tracking-tight">System <span className="text-emerald-500">Settings</span></h2>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 tracking-widest mb-2">Store Sync Endpoint</label>
            <input 
              type="text" 
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              placeholder="https://storesync.app/api/inventory"
              className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-sm font-mono text-emerald-500 focus:border-emerald-500/50 outline-none transition-colors"
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded border border-slate-800">
            <div>
              <p className="text-sm font-bold text-slate-200">Auto-Transmission</p>
              <p className="text-[10px] text-slate-500 font-mono">Sync instantly on scan success</p>
            </div>
            <button 
              onClick={() => onUpdate({ ...settings, autoSync: !settings.autoSync })}
              className={cn(
                "w-12 h-6 rounded-full transition-colors relative",
                settings.autoSync ? "bg-emerald-500" : "bg-slate-800"
              )}
            >
              <div className={cn(
                "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform",
                settings.autoSync ? "translate-x-6" : "translate-x-0"
              )} />
            </button>
          </div>

          <div>
              <p className="text-[10px] font-bold uppercase text-slate-500 tracking-widest mb-3">Sync Method</p>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => onUpdate({ ...settings, method: 'POST' })}
                  className={cn(
                    "py-3 rounded border font-mono text-[10px] font-bold tracking-widest transition-all",
                    settings.method === 'POST' ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "border-slate-800 text-slate-500 hover:border-slate-700"
                  )}
                >
                  WEBHOOK (POST)
                </button>
                <button 
                  onClick={() => onUpdate({ ...settings, method: 'REDIRECT' })}
                  className={cn(
                    "py-3 rounded border font-mono text-[10px] font-bold tracking-widest transition-all",
                    settings.method === 'REDIRECT' ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "border-slate-800 text-slate-500 hover:border-slate-700"
                  )}
                >
                  REDIRECT (GET)
                </button>
              </div>
          </div>

          <button 
            onClick={handleSave}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-4 rounded uppercase text-xs transition-all mt-4"
          >
            Apply Configuration
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
