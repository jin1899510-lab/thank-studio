
import React from 'react';
import { Sparkles, ShieldCheck, Key, Zap } from 'lucide-react';

interface HeaderProps {
  onKeyClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onKeyClick }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-[100]">
      <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
        <div className="flex items-center gap-5">
          <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-2xl shadow-blue-500/20">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-2xl font-black text-white italic tracking-tighter">
              STUDIO <span className="text-blue-600">RE-IMAGINED</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">차세대 시각 지능 엔진</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={onKeyClick}
            className="flex items-center gap-3 px-5 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-2xl transition-all group"
          >
            <Key className="w-4 h-4 text-blue-500 group-hover:rotate-12 transition-transform" />
            <span className="text-[11px] font-black text-slate-300 uppercase tracking-widest hidden md:inline">API 키 설정 및 관리</span>
          </button>
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl border border-blue-500/20">
             <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>
    </header>
  );
};
