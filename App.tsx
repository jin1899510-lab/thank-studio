
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { ImageItem, TransformationStats, TransformationOptions, CompositionType, DedicatedFilterType, TextOverlay } from './types';
import { analyzeImageCategory, transformImage, recommendTextColor, fileToBase64 } from './services/geminiService';
import { Play, Zap, Settings, Trash2, Download, Send, Type as TypeIcon, Sparkles, Key, X, Info, ExternalLink, CheckCircle, ShieldAlert } from 'lucide-react';

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
  
  // API 키 관련 상태 (Vercel 지원을 위해 초기값은 무조건 체크)
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [isAistudioEnv, setIsAistudioEnv] = useState(false);

  const [options, setOptions] = useState<TransformationOptions>({
    composition: 'original',
    zoom: 'none',
    filter: 'none',
    resolution: '1500' 
  });

  // 앱 시작 시 API 키 체크
  useEffect(() => {
    const checkApiKey = async () => {
      // 1. AI Studio 환경 여부 확인
      const win = window as any;
      const isAistudio = !!(win.aistudio && win.aistudio.hasSelectedApiKey);
      setIsAistudioEnv(isAistudio);

      if (isAistudio) {
        try {
          const hasKey = await win.aistudio.hasSelectedApiKey();
          if (!hasKey) setShowKeySetup(true);
        } catch (e) {
          setShowKeySetup(true);
        }
      } else {
        // 2. Vercel 등 일반 브라우저 환경
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if (!savedKey) {
          setShowKeySetup(true);
        } else {
          setManualKey(savedKey);
        }
      }
    };

    checkApiKey();
  }, []);

  const handleSaveKey = async () => {
    if (isAistudioEnv) {
      await (window as any).aistudio?.openSelectKey();
      setShowKeySetup(false);
    } else {
      const key = manualKey.trim();
      if (key && key.startsWith('AIza')) {
        localStorage.setItem('GEMINI_API_KEY', key);
        setShowKeySetup(false);
        // 저장이 완료되었음을 알림
        alert("API 키가 성공적으로 저장되었습니다.");
      } else {
        alert("올바른 Gemini API 키를 입력해주세요. (AIza...로 시작해야 합니다)");
      }
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
    const color = await recommendTextColor(base64);
    updateTaskOverlay(id, { color });
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
        const errMsg = err.message || "";
        if (errMsg.includes("API_KEY_EXPIRED") || errMsg.includes("API_KEY_MISSING")) {
          setShowKeySetup(true);
        }
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'error', error: errMsg } : img));
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
      const errMsg = err.message || "";
      if (errMsg.includes("API_KEY_EXPIRED")) setShowKeySetup(true);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', error: errMsg } : i));
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden">
      <Header />
      
      {/* API Key Setup Modal - Vercel에서 확실히 보이도록 스타일 강화 */}
      {showKeySetup && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-md bg-white rounded-[32px] overflow-hidden shadow-2xl ring-1 ring-white/20">
            {/* Header */}
            <div className="bg-[#D97706] p-8 pb-10 flex items-center justify-between relative text-white">
              <div className="flex items-center gap-3">
                <Key className="w-7 h-7" />
                <h2 className="text-2xl font-bold tracking-tight">Gemini API 키 설정</h2>
              </div>
              <button onClick={() => setShowKeySetup(false)} className="p-2 hover:bg-black/10 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
              <p className="absolute bottom-4 left-8 text-sm font-medium opacity-90">변환 기능을 위해 사용자 키가 필요합니다.</p>
            </div>

            {/* Content */}
            <div className="p-8 space-y-8">
              <div className="bg-[#FFFBEB] border border-[#FEF3C7] rounded-2xl p-5 flex gap-3 text-[#92400E]">
                <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed font-medium">
                  본 서비스는 <b>개인 API 키</b>를 브라우저(localStorage)에만 안전하게 저장합니다. 입력한 키는 서버로 전송되지 않습니다.
                </p>
              </div>

              <div className="space-y-4">
                <label className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-widest block">GEMINI API KEY (AIza...)</label>
                
                {isAistudioEnv ? (
                  <button 
                    onClick={handleSaveKey} 
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-5 py-4 text-[#64748B] text-sm flex items-center justify-between hover:border-[#D97706] transition-all"
                  >
                    <span>여기를 클릭하여 시스템 키 선택</span>
                    <Sparkles className="w-4 h-4 text-[#D97706]" />
                  </button>
                ) : (
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="AIza...로 시작하는 키를 직접 입력하세요"
                      value={manualKey}
                      onChange={(e) => setManualKey(e.target.value)}
                      className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-5 py-4 text-slate-900 text-sm focus:border-[#D97706] focus:ring-1 focus:ring-[#D97706] outline-none transition-all pr-12"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {manualKey.trim().startsWith('AIza') ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Key className="w-5 h-5 text-slate-300" />}
                    </div>
                  </div>
                )}
                
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-[#D97706] font-bold hover:underline w-fit">
                  Google AI Studio에서 키 무료 발급 받기 <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <button 
                onClick={handleSaveKey}
                className="w-full py-5 bg-[#D97706] hover:bg-[#B45309] text-white font-black text-lg rounded-2xl shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                설정 완료 및 시작하기
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        <section className="mb-12 flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <h2 className="text-3xl font-bold text-white mb-2 uppercase tracking-tight">AI Studio Re-Imagined</h2>
            <p className="text-slate-400 mb-6 font-medium">유사 사진 검사에 걸리지 않는 고유한 스튜디오급 고화질 사진을 일괄 생성합니다.</p>
            <ImageUploader onUpload={handleUpload} count={images.length} disabled={isProcessing} />
          </div>
          
          <div className="w-full lg:w-80 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 h-fit sticky top-24">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-white border-b border-slate-800 pb-2">
              <Settings className="w-4 h-4 text-blue-500" /> 일괄 변환 설정
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">촬영 구도</label>
                <select value={options.composition} onChange={e => setOptions({...options, composition: e.target.value as CompositionType})} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs">
                  <option value="original">원본 구도 유지</option>
                  <option value="flat-lay">항공샷 (Flat-lay)</option>
                  <option value="side-view">측면샷 (Side-view)</option>
                  <option value="cinematic">시네마틱 와이드</option>
                  <option value="close-up">클로즈업 매크로</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">스타일 필터</label>
                <select value={options.filter} onChange={e => setOptions({...options, filter: e.target.value as DedicatedFilterType})} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs">
                  <option value="none">AI 자동 보정 ✨</option>
                  <option value="food-meat">🥘 육즙 & 그릴</option>
                  <option value="food-studio">🍛 하이엔드 미식 화보</option>
                  <option value="profile">👤 럭셔리 인물 프로필</option>
                </select>
              </div>
              <button onClick={startProcessing} disabled={isProcessing || images.length === 0} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                {isProcessing ? <Zap className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />} 일괄 작업 시작
              </button>
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              작업 리스트 <span className="text-blue-500 text-sm font-mono">[{stats.completed}/{stats.total}]</span>
            </h3>
            {images.length > 0 && (
               <button onClick={() => setImages([])} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1.5 font-bold transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> 리스트 초기화
               </button>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {images.filter(img => img.status !== 'idle').map(task => (
              <div key={task.id} className="group bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative transition-all hover:border-slate-700">
                <button onClick={() => handleRemove(task.id)} className="absolute top-3 right-3 z-30 p-1.5 bg-black/40 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all border border-white/10 backdrop-blur-sm">
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="aspect-square bg-black relative">
                  {(task.status === 'processing' || task.status === 'analyzing') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20">
                      <Zap className="w-10 h-10 text-blue-500 animate-bounce mb-2" />
                      <p className="text-xs font-black tracking-widest animate-pulse">CREATING MAGIC...</p>
                    </div>
                  )}
                  {task.processedUrl ? (
                    <div className="relative w-full h-full">
                      <img src={task.processedUrl} className="w-full h-full object-cover" alt="Processed" />
                      {task.textOverlay?.text && (
                        <div 
                          className="absolute left-0 right-0 px-4 text-center drop-shadow-2xl font-bold pointer-events-none"
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
                    <img src={task.previewUrl} className="w-full h-full object-cover opacity-50 grayscale" alt="Preview" />
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {task.processedUrl && (
                    <div className="flex flex-col gap-3">
                      {editingTextId === task.id ? (
                        <div className="bg-slate-800 p-4 rounded-xl border border-blue-500/30 space-y-4">
                          <input type="text" placeholder="문구 입력..." value={task.textOverlay?.text || ''} onChange={e => updateTaskOverlay(task.id, { text: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                          <div className="grid grid-cols-2 gap-2">
                            <select value={task.textOverlay?.font || 'Inter'} onChange={e => updateTaskOverlay(task.id, { font: e.target.value })} className="bg-slate-900 text-xs p-2 rounded-lg text-white">
                              {FONT_OPTIONS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <div className="flex gap-2">
                              <input type="color" value={task.textOverlay?.color || '#FFFFFF'} onChange={e => updateTaskOverlay(task.id, { color: e.target.value })} className="w-10 h-10 bg-transparent cursor-pointer" />
                              <button onClick={() => handleRecommendColor(task.id)} className="bg-slate-700 hover:bg-slate-600 text-[10px] rounded px-2 font-bold transition-all">AI 추천</button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 uppercase font-bold">크기: {task.textOverlay?.size}px</label>
                            <input type="range" min="10" max="150" value={task.textOverlay?.size || 40} onChange={e => updateTaskOverlay(task.id, { size: parseInt(e.target.value) })} className="w-full accent-blue-500" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 uppercase font-bold">위치: {task.textOverlay?.yPosition}%</label>
                            <input type="range" min="5" max="95" value={task.textOverlay?.yPosition || 50} onChange={e => updateTaskOverlay(task.id, { yPosition: parseInt(e.target.value) })} className="w-full accent-blue-500" />
                          </div>
                          <button onClick={() => setEditingTextId(null)} className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg text-xs font-bold text-white transition-colors">편집 완료</button>
                        </div>
                      ) : activeRefineId === task.id ? (
                        <div className="bg-slate-800 p-4 rounded-xl border border-orange-500/30 space-y-3">
                          <textarea autoFocus placeholder="보정 요청(예: 배경을 더 어둡게, 푸른 조명 추가...)" value={refineInput} onChange={e => setRefineInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs min-h-[60px] text-white" />
                          <div className="flex gap-2">
                            <button onClick={() => handleRefine(task.id, refineInput)} className="flex-1 bg-orange-600 hover:bg-orange-500 py-2 rounded-lg text-xs font-bold text-white">보정 적용</button>
                            <button onClick={() => {setActiveRefineId(null); setRefineInput('');}} className="px-3 bg-slate-700 py-2 rounded-lg text-xs font-bold">취소</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <button onClick={() => setEditingTextId(task.id)} className="flex-1 bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-[11px] font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all">
                              <TypeIcon className="w-3.5 h-3.5 text-blue-400" /> 텍스트 편집
                            </button>
                            <button onClick={() => setActiveRefineId(task.id)} className="flex-1 bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-[11px] font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all">
                              <Sparkles className="w-3.5 h-3.5 text-orange-400" /> AI 재보정
                            </button>
                          </div>
                          <button onClick={() => downloadCombined(task)} className="w-full bg-green-600 hover:bg-green-500 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 text-white transition-all shadow-lg shadow-green-900/10">
                            <Download className="w-4 h-4" /> 결과 저장
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {task.error && <p className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded font-medium border border-red-500/20">{task.error}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="py-12 border-t border-slate-900 bg-slate-900/30 text-center space-y-4">
        <div className="flex justify-center gap-8 text-sm text-slate-500 font-medium">
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="hover:text-blue-400 underline underline-offset-4 decoration-slate-800 transition-colors font-bold">빌링 가이드</a>
          <button onClick={() => setShowKeySetup(true)} className="hover:text-blue-400 flex items-center gap-1.5 transition-colors font-bold">
            <Key className="w-3.5 h-3.5" /> API 키 재설정
          </button>
        </div>
        <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest">Powered by Gemini 3.0 Pro Vision Engine</p>
      </footer>
    </div>
  );
};

export default App;
