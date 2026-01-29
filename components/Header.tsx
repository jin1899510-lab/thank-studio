
import React from 'react';
import { ShieldCheck, Zap, Settings, Key, AlertCircle } from 'lucide-react';

interface HeaderProps {
  onOpenSettings: () => void;
  isKeyValid: boolean | null;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings, isKeyValid }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-[100]">
      <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
        <div className="flex items-center gap-5">
          <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-2xl shadow-blue-500/20">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white italic tracking-tighter">
              STUDIO <span className="text-blue-600">RE-IMAGINED</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">차세대 시각 지능 엔진</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`hidden md:flex items-center gap-2 px-4 py-2 border rounded-xl transition-all ${
            isKeyValid === true ? 'bg-emerald-500/10 border-emerald-500/30' : 
            isKeyValid === false ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-900 border-slate-800'
          }`}>
            {isKeyValid === true ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : 
             isKeyValid === false ? <AlertCircle className="w-4 h-4 text-red-500" /> : <Key className="w-4 h-4 text-slate-500" />}
            <span className={`text-[10px] font-black uppercase tracking-widest ${
              isKeyValid === true ? 'text-emerald-500' : isKeyValid === false ? 'text-red-500' : 'text-slate-400'
            }`}>
              {isKeyValid === true ? 'Authenticated' : isKeyValid === false ? 'Key Error' : 'Set API Key'}
            </span>
          </div>
          
          <button 
            onClick={onOpenSettings}
            className="p-3 hover:bg-slate-800 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-800"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};
