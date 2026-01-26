
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { ImageItem, TransformationStats, TransformationOptions, CompositionType, DedicatedFilterType, TextOverlay } from './types';
import { analyzeImageCategory, transformImage, recommendTextColor, fileToBase64, testConnection } from './services/geminiService';
import { 
  Play, Zap, Settings, Trash2, Download, Send, Type as TypeIcon, 
  Sparkles, Key, X, Info, ExternalLink, CheckCircle, ShieldAlert, 
  Database, Save, FileUp, Loader2, AlertTriangle, ShieldCheck, Heart
} from 'lucide-react';

const FONT_OPTIONS = [
  { name: 'Inter (기본)', class: 'font-inter' },
  { name: 'Bebas Neue (강렬)', class: 'font-bebas' },
  { name: 'Montserrat (모던)', class: 'font-montserrat' },
  { name: 'Playfair (우아)', class: 'font-playfair' },
  { name: 'Nanum Pen (손글씨)', class: 'font-nanum' },
  { name: 'Noto Sans KR (깔끔)', class: 'font-noto' },
];

const App: React.FC = () => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [activeRefineId, setActiveRefineId] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState('');
  
  // API 키 관리 상태
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [tempKey, setTempKey] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testErrorMessage, setTestErrorMessage] = useState('');
  const [isAistudioEnv, setIsAistudioEnv] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [options, setOptions] = useState<TransformationOptions>({
    composition: 'original',
    zoom: 'none',
    filter: 'none',
    resolution: '1000' // 무료 키 호환성을 위해 기본을 1000px(1K)로 설정
  });

  // 초기 로드 시 키 확인
  useEffect(() => {
    const initApp = async () => {
      const win = window as any;
      const hasSystemKey = !!(win.aistudio && win.aistudio.hasSelectedApiKey);
      setIsAistudioEnv(hasSystemKey);

      const saved = localStorage.getItem('GEMINI_API_KEY_ENCRYPTED');
      if (saved) {
        try {
          setTempKey(atob(saved));
        } catch (e) {}
      } else if (!hasSystemKey) {
        setTimeout(() => setShowKeyManager(true), 500);
      }
    };
    initApp();
  }, []);

  const handleTestKey = async () => {
    if (!tempKey.trim()) return;
    setTestStatus('testing');
    setTestErrorMessage('');
    const result = await testConnection(tempKey.trim());
    if (result.success) {
      setTestStatus('success');
    } else {
      setTestStatus('failed');
      setTestErrorMessage(result.message || '인증 실패');
    }
  };

  const saveToLocal = () => {
    const key = tempKey.trim();
    if (key.startsWith('AIza')) {
      localStorage.setItem('GEMINI_API_KEY_ENCRYPTED', btoa(key));
      alert("브라우저 로컬 드라이브에 키가 암호화되어 저장되었습니다.");
      if (testStatus === 'success') setShowKeyManager(false);
    } else {
      alert("올바른 Gemini API 키 형식이 아닙니다.");
    }
  };

  const exportConfig = () => {
    if (!tempKey) return alert("내보낼 키 정보가 없습니다.");
    const config = {
      key: btoa(tempKey),
      created_at: new Date().toISOString(),
      provider: "Google Gemini",
      tier: "Free/Paid Compatible"
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `config_${new Date().getTime()}.studio`;
    link.click();
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.key) {
          const key = atob(json.key);
          setTempKey(key);
          setTestStatus('idle');
          alert("설정 파일에서 API 키를 성공적으로 가져왔습니다.");
        }
      } catch (err) {
        alert("잘못된 형식의 설정 파일입니다.");
      }
    };
    reader.readAsText(file);
  };

  const stats: TransformationStats = useMemo(() => ({
    total: images.length,
    completed: images.filter(img => img.status === 'completed').length,
    failed: images.filter(img => img.status === 'error').length,
    processing: images.filter(img => img.status === 'processing' || img.status === 'analyzing').length,
  }), [images]);

  const handleUpload = useCallback(async (files: FileList) => {
    const newFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newImages: ImageItem[] = newFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'idle',
      originalName: file.name,
      history: [],
      currentZoom: 'none'
    }));
    setImages(prev => [...prev, ...newImages].slice(0, 100));
  }, []);

  const handleRemove = (id: string) => setImages(prev => prev.filter(img => img.id !== id));

  const updateTaskOverlay = (id: string, overlay: Partial<TextOverlay>) => {
    setImages(prev => prev.map(img => img.id === id ? {
      ...img,
      textOverlay: { text: '', font: 'Inter', color: '#FFFFFF', size: 40, yPosition: 50, ...img.textOverlay, ...overlay }
    } : img));
  };

  const handleRecommendColor = async (id: string) => {
    const img = images.find(i => i.id === id);
    if (!img || !img.processedUrl) return;
    const base64 = img.processedUrl.split(',')[1];
    try {
      const color = await recommendTextColor(base64);
      updateTaskOverlay(id, { color });
    } catch (e) {
      setShowKeyManager(true);
    }
  };

  const downloadCombined = (task: ImageItem) => {
    if (!task.processedUrl) return;
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      if (task.textOverlay && task.textOverlay.text) {
        const { text, font, color, size, yPosition } = task.textOverlay;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const scale = canvas.height / 400; 
        ctx.font = `bold ${size * scale}px ${font}`;
        ctx.fillText(text, canvas.width / 2, (yPosition / 100) * canvas.height);
      }
      const link = document.createElement('a');
      link.download = `studio_${task.id}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = task.processedUrl;
  };

  const startProcessing = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    const pending = images.filter(img => img.status === 'idle' || img.status === 'error');
    
    for (const image of pending) {
      try {
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'analyzing' } : img));
        const base64 = await fileToBase64(image.file);
        const category = await analyzeImageCategory(base64);
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'processing', category } : img));
        const remixedUrl = await transformImage(base64, category, options);
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'completed', processedUrl: remixedUrl } : img));
      } catch (err: any) {
        if (err.message?.includes("API_KEY") || err.message?.includes("MISSING")) {
          setShowKeyManager(true);
          break;
        }
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'error', error: err.message } : img));
      }
    }
    setIsProcessing(false);
  };

  const handleRefine = async (id: string, prompt: string) => {
    const img = images.find(i => i.id === id);
    if (!img || !img.processedUrl || isProcessing) return;
    setIsProcessing(true);
    setActiveRefineId(null);
    try {
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'processing' } : i));
      const base64 = await fileToBase64(img.file);
      const refined = await transformImage(base64, img.category || 'Other', options, prompt);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'completed', processedUrl: refined } : i));
    } catch (err: any) {
      if (err.message?.includes("API_KEY")) setShowKeyManager(true);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', error: err.message } : i));
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden">
      <Header onKeyClick={() => setShowKeyManager(true)} />
      
      {/* External API Key Manager Modal */}
      {showKeyManager && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl ring-1 ring-white/10">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-700 to-indigo-700 p-10 flex items-center justify-between text-white relative overflow-hidden">
              <div className="flex items-center gap-5 z-10">
                <div className="p-4 bg-white/10 rounded-3xl backdrop-blur-md border border-white/20">
                  <ShieldCheck className="w-9 h-9" />
                </div>
                <div>
                  <h2 className="text-3xl font-black tracking-tight">외부 API 보안 매니저</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-blue-100/80 text-sm font-medium">사용자 지정 API 키 연동</p>
                    <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded text-[10px] font-black text-green-400 uppercase tracking-tighter flex items-center gap-1">
                      <Heart className="w-2.5 h-2.5 fill-current" /> Free Tier Supported
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setShowKeyManager(false)} className="p-2 hover:bg-black/10 rounded-full transition-colors z-10">
                <X className="w-8 h-8" />
              </button>
            </div>

            {/* Body */}
            <div className="p-10 space-y-10 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {/* Input Section */}
              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-500" /> Gemini API KEY (AIza...)
                  </label>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 font-bold hover:underline flex items-center gap-1">
                    무료 키 발급받기 <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="relative group">
                  <input 
                    type="password"
                    placeholder="여기에 API 키를 붙여넣으세요"
                    value={tempKey}
                    onChange={(e) => {setTempKey(e.target.value); setTestStatus('idle'); setTestErrorMessage('');}}
                    className="w-full bg-slate-800/50 border-2 border-slate-700/50 rounded-2xl px-7 py-6 text-white focus:border-blue-500 outline-none transition-all placeholder:text-slate-600 font-mono text-lg shadow-inner"
                  />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-3">
                    {testStatus === 'testing' && <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />}
                    {testStatus === 'success' && <div className="p-1.5 bg-green-500/20 rounded-full"><CheckCircle className="w-6 h-6 text-green-500 animate-in zoom-in" /></div>}
                    {testStatus === 'failed' && <div className="p-1.5 bg-red-500/20 rounded-full"><AlertTriangle className="w-6 h-6 text-red-500 animate-bounce" /></div>}
                  </div>
                </div>
                
                {testErrorMessage && (
                   <div className="text-[11px] text-red-400 font-bold bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex items-center gap-2">
                     <AlertTriangle className="w-3.5 h-3.5" /> {testErrorMessage}
                   </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={handleTestKey}
                    disabled={testStatus === 'testing' || !tempKey}
                    className="py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl text-[11px] font-black flex items-center justify-center gap-2 transition-all border border-slate-700 uppercase tracking-widest disabled:opacity-50"
                  >
                    {testStatus === 'testing' ? '연결 확인 중...' : '연결 상태 테스트'}
                  </button>
                  <button 
                    onClick={saveToLocal}
                    disabled={!tempKey}
                    className="py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-[11px] font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 uppercase tracking-widest disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" /> 현재 세션에 저장
                  </button>
                </div>
              </div>

              {/* Config Files */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="group p-7 bg-slate-800/30 border border-slate-700/50 rounded-[32px] space-y-4 hover:border-blue-500/30 transition-all hover:bg-slate-800/50">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-white flex items-center gap-2"><Save className="w-4 h-4 text-blue-400" /> 키 정보 내보내기</h4>
                    <Save className="w-5 h-5 text-slate-700 group-hover:text-blue-500/50" />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">설정을 .studio 파일로 로컬 드라이브에 안전하게 보관합니다.</p>
                  <button onClick={exportConfig} className="w-full py-3.5 bg-slate-700 hover:bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Download .studio</button>
                </div>
                <div className="group p-7 bg-slate-800/30 border border-slate-700/50 rounded-[32px] space-y-4 hover:border-indigo-500/30 transition-all hover:bg-slate-800/50">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-white flex items-center gap-2"><FileUp className="w-4 h-4 text-indigo-400" /> 설정 불러오기</h4>
                    <FileUp className="w-5 h-5 text-slate-700 group-hover:text-indigo-500/50" />
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">이전에 저장했던 설정 파일을 불러와 즉시 연결을 활성화합니다.</p>
                  <input type="file" accept=".studio" ref={fileInputRef} onChange={importConfig} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-3.5 bg-slate-700 hover:bg-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Upload .studio</button>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-3xl p-6 flex gap-4 text-amber-200">
                <ShieldAlert className="w-6 h-6 flex-shrink-0 mt-0.5 text-amber-400" />
                <div className="space-y-1">
                   <p className="text-xs font-black uppercase tracking-widest">Security Notice</p>
                   <p className="text-[11px] leading-relaxed font-medium text-amber-100/70">
                    본 앱은 무료 키 사용 시 호출 제한(RPM)이 적용될 수 있습니다. 대량 작업 시 변환 오류가 발생하면 잠시 후 다시 시도하시거나 유료 키 사용을 권장합니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-10 bg-slate-950/50 border-t border-slate-800 flex justify-end">
              <button 
                onClick={() => setShowKeyManager(false)}
                className="px-10 py-4 text-slate-500 hover:text-white font-black text-xs uppercase tracking-[0.2em] transition-all hover:bg-white/5 rounded-2xl"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        <section className="mb-12 flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <h2 className="text-5xl font-black text-white mb-2 uppercase tracking-tighter leading-none italic">Studio <span className="text-blue-600">Re-Imagined</span></h2>
            <p className="text-slate-400 mb-8 font-bold font-mono text-sm tracking-widest opacity-60">PRO BATCH TRANSFORMATION ENGINE v2.5 (Free Tier Support)</p>
            <ImageUploader onUpload={handleUpload} count={images.length} disabled={isProcessing} />
          </div>
          
          <div className="w-full lg:w-80 bg-slate-900/40 border border-slate-800 rounded-3xl p-7 h-fit sticky top-24 backdrop-blur-md">
            <h3 className="flex items-center gap-2 font-black mb-8 text-white border-b border-slate-800 pb-4 uppercase text-[10px] tracking-[0.3em]">
              <Settings className="w-5 h-5 text-blue-500" /> ENGINE CONFIG
            </h3>
            <div className="space-y-7">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Composition Mode</label>
                <select value={options.composition} onChange={e => setOptions({...options, composition: e.target.value as CompositionType})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="original">Keep Original</option>
                  <option value="flat-lay">Flat-lay (Top down)</option>
                  <option value="side-view">Side-view (Pro)</option>
                  <option value="cinematic">Cinematic Wide</option>
                  <option value="close-up">Macro Detail</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Style Filter</label>
                <select value={options.filter} onChange={e => setOptions({...options, filter: e.target.value as DedicatedFilterType})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="none">AI Auto Optimize ✨</option>
                  <option value="food-meat">🥘 Juicy & Grill Focus</option>
                  <option value="food-studio">🍛 High-end Editorial</option>
                  <option value="profile">👤 Luxury Profile</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Resolution Tier</label>
                <select value={options.resolution} onChange={e => setOptions({...options, resolution: e.target.value as any})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="1000">1K (Free Tier Friendly)</option>
                  <option value="1500">1.5K (Balanced)</option>
                  <option value="2000">2K (Paid/Pro Req.)</option>
                </select>
              </div>
              <button 
                onClick={startProcessing} 
                disabled={isProcessing || images.length === 0} 
                className="w-full py-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-2xl shadow-blue-900/40 active:scale-95 transition-all flex items-center justify-center gap-4 uppercase text-sm tracking-[0.2em]"
              >
                {isProcessing ? <Zap className="w-6 h-6 animate-pulse" /> : <Play className="w-6 h-6" />} Start Batch
              </button>
            </div>
          </div>
        </section>

        <section className="pb-32">
          <div className="flex items-center justify-between mb-10 border-b border-slate-900 pb-8">
            <h3 className="text-2xl font-black text-white flex items-center gap-4 italic">
              ENGINE QUEUE <span className="text-blue-600 font-mono not-italic tracking-tighter bg-blue-600/10 px-4 py-1 rounded-full">[{stats.completed} / {stats.total}]</span>
            </h3>
            {images.length > 0 && (
               <button onClick={() => setImages([])} className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-3 font-black uppercase tracking-[0.3em] transition-all group">
                  <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform" /> Reset Queue
               </button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
            {images.filter(img => img.status !== 'idle').map(task => (
              <div key={task.id} className="group bg-slate-900/50 border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl relative transition-all hover:border-slate-600 hover:bg-slate-900 hover:shadow-blue-900/20">
                <button onClick={() => handleRemove(task.id)} className="absolute top-5 right-5 z-30 p-3 bg-black/60 hover:bg-red-600 text-white rounded-2xl opacity-0 group-hover:opacity-100 transition-all border border-white/10 backdrop-blur-md">
                  <Trash2 className="w-5 h-5" />
                </button>

                <div className="aspect-square bg-slate-950 relative overflow-hidden">
                  {(task.status === 'processing' || task.status === 'analyzing') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-md">
                      <div className="relative">
                        <Zap className="w-20 h-20 text-blue-500 animate-bounce mb-6" />
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl animate-pulse"></div>
                      </div>
                      <p className="text-[10px] font-black tracking-[0.8em] animate-pulse text-blue-400 uppercase">Engine Processing</p>
                    </div>
                  )}
                  {task.processedUrl ? (
                    <div className="relative w-full h-full">
                      <img src={task.processedUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="Processed" />
                      {task.textOverlay?.text && (
                        <div 
                          className="absolute left-0 right-0 px-10 text-center drop-shadow-[0_15px_30px_rgba(0,0,0,1)] font-bold pointer-events-none"
                          style={{ 
                            top: `${task.textOverlay.yPosition}%`, 
                            transform: 'translateY(-50%)',
                            color: task.textOverlay.color,
                            fontSize: `${task.textOverlay.size}px`,
                            fontFamily: task.textOverlay.font 
                          }}
                        >
                          {task.textOverlay.text}
                        </div>
                      )}
                    </div>
                  ) : (
                    <img src={task.previewUrl} className="w-full h-full object-cover opacity-20 grayscale scale-125 blur-xl" alt="Preview" />
                  )}
                </div>

                <div className="p-8 space-y-6">
                  {task.processedUrl && (
                    <div className="flex flex-col gap-5">
                      {editingTextId === task.id ? (
                        <div className="bg-slate-800/80 p-8 rounded-[32px] border border-blue-500/30 space-y-6 animate-in slide-in-from-bottom-8">
                          <input type="text" placeholder="Enter headline..." value={task.textOverlay?.text || ''} onChange={e => updateTaskOverlay(task.id, { text: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-6 py-5 text-sm text-white outline-none focus:border-blue-500 font-bold shadow-inner" />
                          <div className="grid grid-cols-2 gap-5">
                            <select value={task.textOverlay?.font || 'Inter'} onChange={e => updateTaskOverlay(task.id, { font: e.target.value })} className="bg-slate-900 text-[10px] p-5 rounded-2xl text-white outline-none border border-slate-700 font-black uppercase tracking-widest">
                              {FONT_OPTIONS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <div className="flex gap-3">
                              <input type="color" value={task.textOverlay?.color || '#FFFFFF'} onChange={e => updateTaskOverlay(task.id, { color: e.target.value })} className="w-16 h-16 bg-transparent cursor-pointer rounded-2xl overflow-hidden border-2 border-slate-700" />
                              <button onClick={() => handleRecommendColor(task.id)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-[10px] rounded-2xl font-black uppercase tracking-tighter transition-all">AI Pick</button>
                            </div>
                          </div>
                          <div className="space-y-5">
                            <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-widest"><span>Size</span><span>{task.textOverlay?.size}px</span></div>
                            <input type="range" min="10" max="150" value={task.textOverlay?.size || 40} onChange={e => updateTaskOverlay(task.id, { size: parseInt(e.target.value) })} className="w-full accent-blue-600" />
                            <div className="flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-widest"><span>Position</span><span>{task.textOverlay?.yPosition}%</span></div>
                            <input type="range" min="5" max="95" value={task.textOverlay?.yPosition || 50} onChange={e => updateTaskOverlay(task.id, { yPosition: parseInt(e.target.value) })} className="w-full accent-blue-600" />
                          </div>
                          <button onClick={() => setEditingTextId(null)} className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-2xl text-xs font-black text-white transition-all shadow-xl shadow-blue-900/40 uppercase tracking-widest">Done</button>
                        </div>
                      ) : activeRefineId === task.id ? (
                        <div className="bg-slate-800/80 p-8 rounded-[32px] border border-orange-500/30 space-y-6 animate-in slide-in-from-bottom-8">
                          <textarea autoFocus placeholder="Describe refinements (e.g. softer lighting, darker background...)" value={refineInput} onChange={e => setRefineInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-5 text-xs min-h-[120px] text-white outline-none focus:border-orange-500 font-medium leading-relaxed" />
                          <div className="flex gap-3">
                            <button onClick={() => handleRefine(task.id, refineInput)} className="flex-1 bg-orange-600 hover:bg-orange-500 py-5 rounded-2xl text-xs font-black text-white shadow-xl shadow-orange-900/40 uppercase tracking-widest">Apply</button>
                            <button onClick={() => {setActiveRefineId(null); setRefineInput('');}} className="px-8 py-5 bg-slate-700 hover:bg-slate-600 rounded-2xl text-xs font-black text-slate-300 uppercase tracking-widest">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-5">
                          <div className="grid grid-cols-2 gap-5">
                            <button onClick={() => setEditingTextId(task.id)} className="bg-slate-800/50 hover:bg-slate-700 py-5 rounded-2xl text-[11px] font-black border border-slate-700 flex items-center justify-center gap-3 transition-all hover:border-blue-500/50 group/btn">
                              <TypeIcon className="w-5 h-5 text-blue-400 group-hover/btn:scale-110 transition-transform" /> Headline
                            </button>
                            <button onClick={() => setActiveRefineId(task.id)} className="bg-slate-800/50 hover:bg-slate-700 py-5 rounded-2xl text-[11px] font-black border border-slate-700 flex items-center justify-center gap-3 transition-all hover:border-orange-500/50 group/btn">
                              <Sparkles className="w-5 h-5 text-orange-400 group-hover/btn:scale-110 transition-transform" /> Refine
                            </button>
                          </div>
                          <button onClick={() => downloadCombined(task)} className="w-full bg-emerald-600 hover:bg-emerald-500 py-6 rounded-[24px] text-xs font-black flex items-center justify-center gap-4 text-white transition-all shadow-2xl shadow-emerald-900/40 active:scale-95 uppercase tracking-[0.2em]">
                            <Download className="w-6 h-6" /> Export Master
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {task.error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[24px] animate-in shake duration-500">
                      <p className="text-[10px] text-red-400 font-black uppercase mb-2 tracking-[0.2em]">Engine Exception</p>
                      <p className="text-[11px] text-red-300 leading-relaxed font-bold">{task.error}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="py-24 border-t border-slate-900 bg-slate-950 text-center space-y-10 relative overflow-hidden">
        <div className="flex justify-center gap-16 text-xs text-slate-500 font-black uppercase tracking-[0.4em] z-10 relative">
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500 transition-colors">Documentation</a>
          <button onClick={() => setShowKeyManager(true)} className="hover:text-blue-500 flex items-center gap-4 transition-colors">
            <Key className="w-6 h-6" /> API Config
          </button>
        </div>
        <div className="flex flex-col items-center gap-5 opacity-40 z-10 relative">
          <p className="text-[11px] text-slate-600 font-black uppercase tracking-[1.2em]">Studio Pro 2025 Edition</p>
          <div className="flex gap-6">
            <div className="w-3 h-3 rounded-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.8)]"></div>
            <div className="w-3 h-3 rounded-full bg-indigo-600 shadow-[0_0_15px_rgba(79,70,229,0.8)]"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.8)]"></div>
          </div>
        </div>
        {/* Decorative elements */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-blue-600/5 blur-[120px] rounded-full"></div>
      </footer>
    </div>
  );
};

export default App;
