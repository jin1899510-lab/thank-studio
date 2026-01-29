
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { ImageItem, TransformationStats, TransformationOptions, DedicatedFilterType, ZoomLevel } from './types';
import { analyzeImageCategory, transformImage, fileToBase64 } from './services/geminiService';
import { 
  Play, Zap, Trash2, Download,
  Loader2, AlertCircle, Info, Minus, Plus, Search,
  CheckCircle2, X, Key, ExternalLink, ShieldCheck, Database,
  Settings, ChevronLeft, ChevronRight
} from 'lucide-react';

const App: React.FC = () => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  
  // API Key State - Now managed via window.aistudio as per guidelines
  const [isKeyValid, setIsKeyValid] = useState<boolean | null>(null);

  const [options, setOptions] = useState<TransformationOptions>({
    composition: 'original',
    zoom: 'none',
    filter: 'none',
    resolution: '1000' 
  });

  // Check for API key selection on mount using aistudio helper
  useEffect(() => {
    const checkKey = async () => {
      if (typeof (window as any).aistudio !== 'undefined') {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setIsKeyValid(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenSettings = async () => {
    if (typeof (window as any).aistudio !== 'undefined') {
      await (window as any).aistudio.openSelectKey();
      // Assume selection was successful as per race condition guidelines to improve UX
      setIsKeyValid(true);
    }
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

  const handleClearResults = () => {
    setImages(prev => prev.filter(img => img.status === 'idle'));
  };

  const handleClearAll = () => {
    setImages([]);
  };

  const startProcessing = async () => {
    // Check for API key before starting, mandatory for Gemini 3 and 2.5 series
    if (typeof (window as any).aistudio !== 'undefined') {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
        setIsKeyValid(true);
      }
    }

    if (isProcessing) return;
    setIsProcessing(true);
    setErrorToast(null);
    const pending = images.filter(img => img.status === 'idle' || img.status === 'error');
    
    for (const image of pending) {
      try {
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'analyzing' } : img));
        const base64 = await fileToBase64(image.file);
        const category = await analyzeImageCategory(base64);
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'processing', category } : img));
        const remixedUrl = await transformImage(base64, category, options);
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'completed', processedUrl: remixedUrl, currentZoom: options.zoom } : img));
      } catch (err: any) {
        const errorMsg = err.message || "알 수 없는 오류";
        
        // Handle mandatory key re-selection on specific "Requested entity was not found." error
        if (errorMsg.includes("Requested entity was not found.") && typeof (window as any).aistudio !== 'undefined') {
          setIsKeyValid(false);
          await (window as any).aistudio.openSelectKey();
          setIsKeyValid(true);
        }

        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'error', error: errorMsg } : img));
        if (errorMsg.includes("403") || errorMsg.includes("ACCESS_DENIED")) {
          setErrorToast("API 키 권한 에러입니다. 설정을 확인해주세요.");
          break;
        }
      }
    }
    setIsProcessing(false);
  };

  const handleIndividualZoom = async (id: string, zoom: ZoomLevel) => {
    const img = images.find(i => i.id === id);
    if (!img || isProcessing) return;

    // Ensure API key is selected before individual refinement
    if (typeof (window as any).aistudio !== 'undefined') {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
        setIsKeyValid(true);
      }
    }

    setIsProcessing(true);
    try {
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'processing', currentZoom: zoom } : i));
      const base64 = await fileToBase64(img.file);
      const zoomOptions = { ...options, zoom };
      const refined = await transformImage(base64, img.category || 'Other', zoomOptions);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'completed', processedUrl: refined } : i));
    } catch (err: any) {
      setErrorToast(err.message);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', error: err.message } : i));
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden font-noto">
      <Header onOpenSettings={handleOpenSettings} isKeyValid={isKeyValid} />
      
      {errorToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[3000] bg-red-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-10">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-bold">{errorToast}</span>
          <button onClick={() => setErrorToast(null)} className="p-1 hover:bg-white/10 rounded-full">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        <section className="mb-12 flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <h2 className="text-5xl font-black text-white mb-2 uppercase tracking-tighter italic font-montserrat">Studio <span className="text-blue-600">Re-Imagined</span></h2>
            <p className="text-slate-400 mb-8 font-bold font-mono text-sm tracking-widest opacity-60 italic">AI Powered Commercial Photography Engine</p>
            <ImageUploader onUpload={handleUpload} count={images.length} disabled={isProcessing} />
          </div>
          
          <div className="w-full lg:w-80 bg-slate-900/40 border border-slate-800 rounded-3xl p-7 h-fit sticky top-24 backdrop-blur-md">
            {/* Added link to billing documentation as required by the guidelines */}
            <div className="mb-4 text-center">
              <a 
                href="https://ai.google.dev/gemini-api/docs/billing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[9px] text-blue-400 hover:text-blue-300 font-bold uppercase tracking-widest flex items-center justify-center gap-1"
              >
                Billing Info <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            
            <h3 className="flex items-center gap-2 font-black mb-8 text-white border-b border-slate-800 pb-4 uppercase text-[10px] tracking-[0.3em]">
              {/* Fixed missing Settings icon import */}
              <Settings className="w-5 h-5 text-blue-500" /> ENGINE CONFIG
            </h3>
            <div className="space-y-7">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">변환 해상도 등급</label>
                <select value={options.resolution} onChange={e => setOptions({...options, resolution: e.target.value as any})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="1000">1K (표준 고화질)</option>
                  <option value="2000">2K (초고화질 - 유료 계정 필수)</option>
                </select>
                {options.resolution === '2000' && (
                  <p className="text-[9px] text-blue-400 font-bold px-1 flex items-center gap-1">
                    <Info className="w-3 h-3" /> 시스템 권한에 따라 처리 시간이 길어질 수 있습니다.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">일괄 스타일 필터</label>
                <select value={options.filter} onChange={e => setOptions({...options, filter: e.target.value as DedicatedFilterType})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="none">AI 자동 최적화 ✨</option>
                  <option value="food-meat">🥘 육즙 & 그릴 강조</option>
                  <option value="food-studio">🍛 하이엔드 푸드 화보</option>
                  <option value="profile">👤 럭셔리 인물 프로필</option>
                </select>
              </div>

              <button 
                onClick={startProcessing} 
                disabled={isProcessing || images.length === 0} 
                className="w-full py-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 uppercase text-sm tracking-[0.2em]"
              >
                {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6" />} 일괄 변환 시작
              </button>
            </div>
          </div>
        </section>

        <section className="pb-32">
          <div className="flex items-center justify-between mb-10 border-b border-slate-900 pb-8">
            <h3 className="text-2xl font-black text-white flex items-center gap-4 italic font-montserrat">
              대기열 <span className="text-blue-600 font-mono not-italic tracking-tighter bg-blue-600/10 px-4 py-1 rounded-full">[{stats.completed} / {stats.total}]</span>
            </h3>
            <div className="flex items-center gap-6">
              {images.some(img => img.status !== 'idle') && (
                <button 
                  onClick={handleClearResults} 
                  className="text-[10px] text-slate-500 hover:text-blue-400 flex items-center gap-3 font-black uppercase tracking-[0.3em] transition-all group"
                >
                   <CheckCircle2 className="w-5 h-5 group-hover:scale-110 transition-transform" /> 결과물만 삭제
                </button>
              )}
              {images.length > 0 && (
                <button 
                  onClick={handleClearAll} 
                  className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-3 font-black uppercase tracking-[0.3em] transition-all group"
                >
                   <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform" /> 전체 삭제
                </button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
            {images.filter(img => img.status !== 'idle').map(task => (
              <div key={task.id} className="group bg-slate-900/50 border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl relative transition-all hover:border-slate-600 hover:bg-slate-900">
                <button onClick={() => handleRemove(task.id)} className="absolute top-5 right-5 z-30 p-3 bg-black/60 hover:bg-red-600 text-white rounded-2xl opacity-0 group-hover:opacity-100 transition-all border border-white/10 backdrop-blur-md">
                  <Trash2 className="w-5 h-5" />
                </button>

                <div className="aspect-square bg-slate-950 relative overflow-hidden">
                  {(task.status === 'processing' || task.status === 'analyzing') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-md">
                      <Zap className="w-20 h-20 text-blue-500 animate-bounce mb-6" />
                      <p className="text-[10px] font-black tracking-[0.8em] animate-pulse text-blue-400 uppercase text-center px-6">
                        {task.status === 'analyzing' ? '미식 분석 중...' : '선명도 변환 중...'}
                      </p>
                    </div>
                  )}
                  {task.processedUrl ? (
                    <div className="relative w-full h-full">
                      <img src={task.processedUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" alt="변환된 사진" />
                    </div>
                  ) : (
                    <img src={task.previewUrl} className="w-full h-full object-cover opacity-20 grayscale scale-125 blur-xl" alt="미리보기" />
                  )}
                </div>

                <div className="p-8 space-y-6">
                  {task.processedUrl && (
                    <div className="flex flex-col gap-5">
                      <div className="bg-slate-800/30 p-3 rounded-2xl border border-slate-700 flex flex-col gap-3">
                        <div className="flex justify-between items-center px-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">AI 구도 조절</label>
                          <span className="text-[9px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase">
                            {task.currentZoom === 'out-2' ? '최대 축소' : task.currentZoom === 'out-1' ? '축소' : task.currentZoom === 'in-1' ? '확대' : task.currentZoom === 'in-2' ? '최대 확대' : '표준'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <button onClick={() => handleIndividualZoom(task.id, 'out-2')} disabled={isProcessing} className={`p-2.5 rounded-xl transition-all flex-1 flex justify-center ${task.currentZoom === 'out-2' ? 'bg-blue-600 text-white' : 'bg-slate-900/50 text-slate-500 hover:bg-slate-700'}`}><Minus className="w-4 h-4" /></button>
                          {/* Fixed missing ChevronLeft icon import */}
                          <button onClick={() => handleIndividualZoom(task.id, 'out-1')} disabled={isProcessing} className={`p-2.5 rounded-xl transition-all flex-1 flex justify-center ${task.currentZoom === 'out-1' ? 'bg-blue-600 text-white' : 'bg-slate-900/50 text-slate-500 hover:bg-slate-700'}`}><ChevronLeft className="w-4 h-4" /></button>
                          <button onClick={() => handleIndividualZoom(task.id, 'none')} disabled={isProcessing} className={`p-2.5 rounded-xl transition-all flex-1 flex justify-center ${task.currentZoom === 'none' || !task.currentZoom ? 'bg-blue-600 text-white' : 'bg-slate-900/50 text-slate-500 hover:bg-slate-700'}`}><Search className="w-4 h-4" /></button>
                          {/* Fixed missing ChevronRight icon import */}
                          <button onClick={() => handleIndividualZoom(task.id, 'in-1')} disabled={isProcessing} className={`p-2.5 rounded-xl transition-all flex-1 flex justify-center ${task.currentZoom === 'in-1' ? 'bg-blue-600 text-white' : 'bg-slate-900/50 text-slate-500 hover:bg-slate-700'}`}><ChevronRight className="w-4 h-4" /></button>
                          <button onClick={() => handleIndividualZoom(task.id, 'in-2')} disabled={isProcessing} className={`p-2.5 rounded-xl transition-all flex-1 flex justify-center ${task.currentZoom === 'in-2' ? 'bg-blue-600 text-white' : 'bg-slate-900/50 text-slate-500 hover:bg-slate-700'}`}><Plus className="w-4 h-4" /></button>
                        </div>
                      </div>

                      <button onClick={() => {
                        const link = document.createElement('a');
                        link.href = task.processedUrl!;
                        link.download = `studio_${task.id}.png`;
                        link.click();
                      }} className="w-full bg-emerald-600 hover:bg-emerald-500 py-6 rounded-[24px] text-xs font-black flex items-center justify-center gap-4 text-white transition-all shadow-2xl shadow-emerald-900/40 uppercase tracking-[0.2em]">
                        <Download className="w-6 h-6" /> 고화질 저장하기
                      </button>
                    </div>
                  )}
                  {task.error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[24px] space-y-4">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em]">ERROR OCCURRED</p>
                      </div>
                      <p className="text-[11px] text-red-300 leading-relaxed font-bold">처리 중 오류가 발생했습니다. API 키 설정을 확인하거나 해상도를 낮춰보세요.</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="py-24 border-t border-slate-900 bg-slate-950 text-center">
        <p className="text-[11px] text-slate-600 font-black uppercase tracking-[1.2em] font-montserrat opacity-40">Studio Pro 2025 Edition</p>
      </footer>
    </div>
  );
};

export default App;
