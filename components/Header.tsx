
import React from 'react';
import { Sparkles, Layers, Image as ImageIcon } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              Transform AI Pro
            </h1>
            <p className="text-xs text-slate-500 font-medium tracking-tight">AI 기반 고화질 고유 이미지 생성 엔진</p>
          </div>
        </div>

        <nav className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Layers className="w-4 h-4 text-blue-400" />
            <span>유사 문서 방지 엔진 가동 중</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400 border-l border-slate-700 pl-6">
            <ImageIcon className="w-4 h-4 text-slate-500" />
            <span>최대 100장 일괄 처리</span>
          </div>
        </nav>
      </div>
    </header>
  );
};
