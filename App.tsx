
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { ImageItem, TransformationStats, TransformationOptions, CompositionType, DedicatedFilterType, TextOverlay } from './types';
import { analyzeImageCategory, transformImage, recommendTextColor, fileToBase64 } from './services/geminiService';
import { Play, Zap, Settings, Trash2, Download, Send, Type as TypeIcon, Sparkles, Key, X, Info, ExternalLink } from 'lucide-react';

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
  const [showKeySetup, setShowKeySetup] = useState(false);
  
  const [options, setOptions] = useState<TransformationOptions>({
    composition: 'original',
    zoom: 'none',
    filter: 'none',
    resolution: '1500' 
  });

  // API 키 체크
  useEffect(() => {
    const checkKey = async () => {
      if (typeof window.aistudio !== 'undefined') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setShowKeySetup(true);
        }
      }
    };
    checkKey();
  }, []);

  // 실제 시스템 키 선택창 호출
  const handleOpenKeySetup = async () => {
    if (typeof window.aistudio !== 'undefined') {
      try {
        await window.aistudio.openSelectKey();
        // 키 선택 후 자동으로 메인 앱으로 진입 시도
        setShowKeySetup(false);
      } catch (err) {
        console.error("Key selection failed", err);
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
        if (err.message === "API_KEY_EXPIRED" || err.message?.includes("entity was not found")) {
          setShowKeySetup(true);
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
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', error: err.message } : i));
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <Header />
      
      {/* API Key Setup Modal (스크린샷 디자인 반영) */}
      {showKeySetup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-white rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-[#D97706] p-8 pb-10 flex items-center justify-between relative">
              <div className="flex items-center gap-3">
                <Key className="w-7 h-7 text-white" />
                <h2 className="text-2xl font-bold text-white tracking-tight">Gemini API 키 설정</h2>
              </div>
              <button onClick={() => setShowKeySetup(false)} className="text-white/80 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
              <p className="absolute bottom-4 left-8 text-white/90 text-sm font-medium">
                API 키를 입력하고 테스트를 완료하면 자동으로 저장됩니다.
              </p>
            </div>

            {/* Content */}
            <div className="p-8 space-y-8">
              <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-2xl p-5 flex gap-3">
                <Info className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[#1E40AF] leading-relaxed font-medium">
                  키는 브라우저 로컬 스토리지에 암호화되어 저장되며 서버로 전송되지 않습니다.
                </p>
              </div>

              <div className="space-y-4">
                <label className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-widest block">GEMINI API KEY</label>
                {/* 실제 입력 필드처럼 보이지만 클릭하면 시스템 키 창을 여는 버튼 */}
                <button 
                  onClick={handleOpenKeySetup}
                  className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-5 py-4 text-[#64748B] text-sm flex items-center justify-between hover:border-[#D97706] hover:bg-orange-50 transition-all text-left"
                >
                  <span className="font-medium">여기를 클릭하여 API 키를 선택/입력하세요</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-white border border-[#E2E8F0] px-2 py-0.5 rounded text-[#94A3B8]">AIza...</span>
                    <Sparkles className="w-4 h-4 text-[#D97706]" />
                  </div>
                </button>
                <a href="https://aistudio.google.com/app/apikey" target="_blank" className="flex items-center gap-1.5 text-sm text-[#D97706] font-bold hover:underline w-fit">
                  API 키 발급받기 <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <button 
                onClick={handleOpenKeySetup}
                className="w-full py-5 bg-[#D97706] hover:bg-[#B45309] text-white font-black text-lg rounded-2xl shadow-lg shadow-orange-900/20 active:scale-[0.98] transition-all"
              >
                연결 테스트 및 저장
              </button>

              <p className="text-center text-[#94A3B8] text-[11px] font-bold italic">
                * 유효한 키를 입력하고 버튼을 누르면 테스트 후 자동 저장됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8">
        <section className="mb-12 flex flex-col lg:flex-row gap-8">
          <div className="flex-1">
            <h2 className="text-3xl font-bold text-white mb-2 uppercase tracking-tight">AI Studio Pro</h2>
            <p className="text-slate-400 mb-6 font-medium">원본의 주인공은 유지하면서 스튜디오급 고화질 사진으로 재탄생시킵니다.</p>
            <ImageUploader onUpload={handleUpload} count={images.length} disabled={isProcessing} />
          </div>
          
          <div className="w-full lg:w-80 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 h-fit sticky top-24">
            <h3 className="flex items-center gap-2 font-bold mb-4 text-white border-b border-slate-800 pb-2">
              <Settings className="w-4 h-4 text-blue-500" /> 마스터 설정
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">촬영 구도</label>
                <select value={options.composition} onChange={e => setOptions({...options, composition: e.target.value as CompositionType})} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs">
                  <option value="original">원본 구도 유지</option>
                  <option value="flat-lay">항공샷 (Flat-lay)</option>
                  <option value="side-view">측면샷 (Side-view)</option>
                  <option value="cinematic">시네마틱 와이드</option>
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
                {isProcessing ? <Zap className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />} 시작하기
              </button>
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              작업 결과물 <span className="text-blue-500 text-sm">{stats.completed}</span>
            </h3>
            {images.some(img => img.status === 'completed') && (
               <button onClick={() => setImages([])} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1.5 font-bold transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> 전체 비우기
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
                      <img src={task.processedUrl} className="w-full h-full object-cover" />
                      {task.textOverlay?.text && (
                        <div 
                          className="absolute left-0 right-0 px-4 text-center drop-shadow-2xl font-bold"
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
                    <img src={task.previewUrl} className="w-full h-full object-cover opacity-50 grayscale" />
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {task.processedUrl && (
                    <div className="flex flex-col gap-3">
                      {editingTextId === task.id ? (
                        <div className="bg-slate-800 p-4 rounded-xl border border-blue-500/30 space-y-4 animate-in slide-in-from-bottom-2">
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
                        <div className="bg-slate-800 p-4 rounded-xl border border-orange-500/30 space-y-3 animate-in slide-in-from-bottom-2">
                          <textarea autoFocus placeholder="보정 요청(예: 더 밝게, 배경을 푸른색으로...)" value={refineInput} onChange={e => setRefineInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs min-h-[60px] text-white" />
                          <div className="flex gap-2">
                            <button onClick={() => handleRefine(task.id, refineInput)} className="flex-1 bg-orange-600 hover:bg-orange-500 py-2 rounded-lg text-xs font-bold text-white">보정 적용</button>
                            <button onClick={() => setActiveRefineId(null)} className="px-3 bg-slate-700 py-2 rounded-lg text-xs font-bold">취소</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <button onClick={() => setEditingTextId(task.id)} className="flex-1 bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-[11px] font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all">
                              <TypeIcon className="w-3.5 h-3.5 text-blue-400" /> 텍스트 넣기
                            </button>
                            <button onClick={() => setActiveRefineId(task.id)} className="flex-1 bg-slate-800 hover:bg-slate-700 py-2.5 rounded-xl text-[11px] font-bold border border-slate-700 flex items-center justify-center gap-2 transition-all">
                              <Sparkles className="w-3.5 h-3.5 text-orange-400" /> AI 재보정
                            </button>
                          </div>
                          <button onClick={() => downloadCombined(task)} className="w-full bg-green-600 hover:bg-green-500 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 text-white transition-all shadow-lg shadow-green-900/10">
                            <Download className="w-4 h-4" /> 저장하기
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
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="hover:text-blue-400 underline underline-offset-4 decoration-slate-800 transition-colors">구글 클라우드 빌링 설정</a>
          <button onClick={() => setShowKeySetup(true)} className="hover:text-blue-400 flex items-center gap-1.5 transition-colors">
            <Key className="w-3.5 h-3.5" /> 키 재설정
          </button>
        </div>
        <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest">Powered by Gemini 3.0 Pro Vision Engine</p>
      </footer>
    </div>
  );
};

export default App;
