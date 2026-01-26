
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { ImageItem, TransformationStats, TransformationOptions, CompositionType, DedicatedFilterType, TextOverlay, ZoomLevel } from './types';
import { analyzeImageCategory, transformImage, recommendTextColor, fileToBase64, testConnection } from './services/geminiService';
import { 
  Play, Zap, Settings, Trash2, Download, Send, Type as TypeIcon, 
  Sparkles, Key, X, Info, ExternalLink, CheckCircle, ShieldAlert, 
  Database, Save, FileUp, Loader2, AlertTriangle, ShieldCheck, Heart,
  Minus, Plus, Search, ChevronLeft, ChevronRight
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
    resolution: '1000' 
  });

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
      alert("브라우저 로컬 스토리지에 API 키가 안전하게 저장되었습니다.");
      if (testStatus === 'success') setShowKeyManager(false);
    } else {
      alert("Gemini API 키 형식이 올바르지 않습니다.");
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
    link.download = `studio_config_${new Date().getTime()}.studio`;
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
      link.download = `transformed_${task.id}.png`;
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
        setImages(prev => prev.map(img => img.id === image.id ? { ...img, status: 'completed', processedUrl: remixedUrl, currentZoom: options.zoom } : img));
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

  const handleIndividualZoom = async (id: string, zoom: ZoomLevel) => {
    const img = images.find(i => i.id === id);
    if (!img || isProcessing) return;
    setIsProcessing(true);
    try {
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'processing', currentZoom: zoom } : i));
      const base64 = await fileToBase64(img.file);
      const zoomOptions = { ...options, zoom };
      const refined = await transformImage(base64, img.category || 'Other', zoomOptions);
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'completed', processedUrl: refined } : i));
    } catch (err: any) {
      setImages(prev => prev.map(i => i.id === id ? { ...i, status: 'error', error: err.message } : i));
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 overflow-x-hidden">
      <Header onKeyClick={() => setShowKeyManager(true)} />
      
      {/* API 키 관리 모달 */}
      {showKeyManager && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl ring-1 ring-white/10">
            <div className="bg-gradient-to-r from-blue-700 to-indigo-700 p-10 flex items-center justify-between text-white relative overflow-hidden">
              <div className="flex items-center gap-5 z-10">
                <div className="p-4 bg-white/10 rounded-3xl backdrop-blur-md border border-white/20">
                  <ShieldCheck className="w-9 h-9" />
                </div>
                <div>
                  <h2 className="text-3xl font-black tracking-tight">API 보안 센터</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-blue-100/80 text-sm font-medium">개인 API 키 연동 관리</p>
                    <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded text-[10px] font-black text-green-400 uppercase tracking-tighter flex items-center gap-1">
                      <Heart className="w-2.5 h-2.5 fill-current" /> 무료 키 지원됨
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setShowKeyManager(false)} className="p-2 hover:bg-black/10 rounded-full transition-colors z-10">
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="p-10 space-y-10 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-500" /> Gemini API 키 (AIza...)
                  </label>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 font-bold hover:underline flex items-center gap-1">
                    무료 키 발급받기 <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="relative group">
                  <input 
                    type="password"
                    placeholder="API 키를 여기에 입력하세요"
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
                    연결 상태 테스트
                  </button>
                  <button 
                    onClick={saveToLocal}
                    disabled={!tempKey}
                    className="py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-[11px] font-black flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 uppercase tracking-widest"
                  >
                    API 키 저장하기
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="group p-7 bg-slate-800/30 border border-slate-700/50 rounded-[32px] space-y-4 hover:border-blue-500/30 transition-all hover:bg-slate-800/50">
                  <h4 className="text-sm font-black text-white flex items-center gap-2">설정 내보내기</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">설정을 .studio 파일로 안전하게 저장합니다.</p>
                  <button onClick={exportConfig} className="w-full py-3.5 bg-slate-700 hover:bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest">파일 다운로드</button>
                </div>
                <div className="group p-7 bg-slate-800/30 border border-slate-700/50 rounded-[32px] space-y-4 hover:border-indigo-500/30 transition-all hover:bg-slate-800/50">
                  <h4 className="text-sm font-black text-white flex items-center gap-2">설정 불러오기</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">저장했던 .studio 설정 파일을 업로드합니다.</p>
                  <input type="file" accept=".studio" ref={fileInputRef} onChange={importConfig} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-3.5 bg-slate-700 hover:bg-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest">파일 업로드</button>
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
            <p className="text-slate-400 mb-8 font-bold font-mono text-sm tracking-widest opacity-60 italic">"더 맛있게, 더 선명하게" - 상업 광고급 사진 변환 시스템</p>
            <ImageUploader onUpload={handleUpload} count={images.length} disabled={isProcessing} />
          </div>
          
          <div className="w-full lg:w-80 bg-slate-900/40 border border-slate-800 rounded-3xl p-7 h-fit sticky top-24 backdrop-blur-md">
            <h3 className="flex items-center gap-2 font-black mb-8 text-white border-b border-slate-800 pb-4 uppercase text-[10px] tracking-[0.3em]">
              <Settings className="w-5 h-5 text-blue-500" /> 엔진 정밀 구성
            </h3>
            <div className="space-y-7">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">피사체 구도 선택</label>
                <select value={options.composition} onChange={e => setOptions({...options, composition: e.target.value as CompositionType})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="original">원본 구도 보존</option>
                  <option value="flat-lay">항공샷 (위에서 아래로)</option>
                  <option value="side-view">정밀 측면샷 (입체감 강조)</option>
                  <option value="cinematic">시네마틱 와이드 뷰</option>
                  <option value="close-up">질감 강조 초근접샷</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">광고급 스타일 필터</label>
                <select value={options.filter} onChange={e => setOptions({...options, filter: e.target.value as DedicatedFilterType})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="none">AI 자동 선명도 최적화 ✨</option>
                  <option value="food-meat">🥘 육즙 & 그릴 질감 극대화</option>
                  <option value="food-studio">🍛 하이엔드 푸드 화보 스타일</option>
                  <option value="profile">👤 럭셔리 인물 프로필 조명</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">해상도 출력 등급</label>
                <select value={options.resolution} onChange={e => setOptions({...options, resolution: e.target.value as any})} className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-5 py-4 text-xs outline-none focus:border-blue-500 font-bold appearance-none transition-all shadow-inner">
                  <option value="1000">1K (일반 변환 모드)</option>
                  <option value="1500">1.5K (고화질 디테일 모드)</option>
                  <option value="2000">2K (초고화질 광고 모드)</option>
                </select>
              </div>
              <button 
                onClick={startProcessing} 
                disabled={isProcessing || images.length === 0} 
                className="w-full py-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-2xl shadow-blue-900/40 active:scale-95 transition-all flex items-center justify-center gap-4 uppercase text-sm tracking-[0.2em]"
              >
                {isProcessing ? <Zap className="w-6 h-6 animate-pulse" /> : <Play className="w-6 h-6" />} 일괄 사진 변환 시작
              </button>
            </div>
          </div>
        </section>

        <section className="pb-32">
          <div className="flex items-center justify-between mb-10 border-b border-slate-900 pb-8">
            <h3 className="text-2xl font-black text-white flex items-center gap-4 italic">
              변환 대기열 <span className="text-blue-600 font-mono not-italic tracking-tighter bg-blue-600/10 px-4 py-1 rounded-full">[{stats.completed} / {stats.total}]</span>
            </h3>
            {images.length > 0 && (
               <button onClick={() => setImages([])} className="text-[10px] text-slate-500 hover:text-red-400 flex items-center gap-3 font-black uppercase tracking-[0.3em] transition-all group">
                  <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform" /> 전체 목록 비우기
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
                      <Zap className="w-20 h-20 text-blue-500 animate-bounce mb-6" />
                      <p className="text-[10px] font-black tracking-[0.8em] animate-pulse text-blue-400 uppercase text-center px-6">
                        {task.status === 'analyzing' ? '이미지 분석 중...' : '광고급 구도로 변환 중...'}
                      </p>
                    </div>
                  )}
                  {task.processedUrl ? (
                    <div className="relative w-full h-full">
                      <img src={task.processedUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="변환된 사진" />
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
                    <img src={task.previewUrl} className="w-full h-full object-cover opacity-20 grayscale scale-125 blur-xl" alt="미리보기" />
                  )}
                </div>

                <div className="p-8 space-y-6">
                  {task.processedUrl && (
                    <div className="flex flex-col gap-5">
                      {/* 줌 컨트롤 바 추가 */}
                      <div className="bg-slate-800/50 p-3 rounded-2xl border border-slate-700 flex flex-col gap-3">
                        <div className="flex justify-between items-center px-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">AI 구도 조절 (줌)</label>
                          <span className="text-[9px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">
                            {task.currentZoom === 'out-2' ? '최대 축소' : task.currentZoom === 'out-1' ? '축소' : task.currentZoom === 'in-1' ? '확대' : task.currentZoom === 'in-2' ? '최대 확대' : '표준'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <button 
                            onClick={() => handleIndividualZoom(task.id, 'out-2')}
                            disabled={isProcessing}
                            className={`p-2.5 rounded-xl transition-all ${task.currentZoom === 'out-2' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                            title="최대 축소 (광각)"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleIndividualZoom(task.id, 'out-1')}
                            disabled={isProcessing}
                            className={`p-2.5 rounded-xl transition-all ${task.currentZoom === 'out-1' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                            title="축소"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleIndividualZoom(task.id, 'none')}
                            disabled={isProcessing}
                            className={`p-2.5 rounded-xl transition-all ${task.currentZoom === 'none' || !task.currentZoom ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                            title="표준 구도"
                          >
                            <Search className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleIndividualZoom(task.id, 'in-1')}
                            disabled={isProcessing}
                            className={`p-2.5 rounded-xl transition-all ${task.currentZoom === 'in-1' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                            title="확대 (클로즈업)"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleIndividualZoom(task.id, 'in-2')}
                            disabled={isProcessing}
                            className={`p-2.5 rounded-xl transition-all ${task.currentZoom === 'in-2' ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-500 hover:text-white hover:bg-slate-700'}`}
                            title="최대 확대 (접사)"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {editingTextId === task.id ? (
                        <div className="bg-slate-800/80 p-8 rounded-[32px] border border-blue-500/30 space-y-6 animate-in slide-in-from-bottom-8">
                          <input type="text" placeholder="광고 문구 입력..." value={task.textOverlay?.text || ''} onChange={e => updateTaskOverlay(task.id, { text: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-6 py-5 text-sm text-white outline-none focus:border-blue-500 font-bold" />
                          <div className="grid grid-cols-2 gap-5">
                            <select value={task.textOverlay?.font || 'Inter'} onChange={e => updateTaskOverlay(task.id, { font: e.target.value })} className="bg-slate-900 text-[10px] p-5 rounded-2xl text-white outline-none border border-slate-700 font-black uppercase">
                              {FONT_OPTIONS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <div className="flex gap-3">
                              <input type="color" value={task.textOverlay?.color || '#FFFFFF'} onChange={e => updateTaskOverlay(task.id, { color: e.target.value })} className="w-16 h-16 bg-transparent cursor-pointer rounded-2xl overflow-hidden border-2 border-slate-700" />
                              <button onClick={() => handleRecommendColor(task.id)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-[10px] rounded-2xl font-black uppercase">색상 추천</button>
                            </div>
                          </div>
                          <button onClick={() => setEditingTextId(null)} className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-2xl text-xs font-black text-white uppercase tracking-widest">편집 완료</button>
                        </div>
                      ) : activeRefineId === task.id ? (
                        <div className="bg-slate-800/80 p-8 rounded-[32px] border border-orange-500/30 space-y-6 animate-in slide-in-from-bottom-8">
                          <textarea autoFocus placeholder="더 맛있게 보이기 위한 요청 (예: 더 붉은빛이 돌게, 더 윤기나게...)" value={refineInput} onChange={e => setRefineInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-5 text-xs min-h-[120px] text-white outline-none focus:border-orange-500" />
                          <div className="flex gap-3">
                            <button onClick={() => handleRefine(task.id, refineInput)} className="flex-1 bg-orange-600 hover:bg-orange-500 py-5 rounded-2xl text-xs font-black text-white uppercase">보정 적용</button>
                            <button onClick={() => {setActiveRefineId(null); setRefineInput('');}} className="px-8 py-5 bg-slate-700 hover:bg-slate-600 rounded-2xl text-xs font-black text-slate-300 uppercase">취소</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-5">
                          <div className="grid grid-cols-2 gap-5">
                            <button onClick={() => setEditingTextId(task.id)} className="bg-slate-800/50 hover:bg-slate-700 py-5 rounded-2xl text-[11px] font-black border border-slate-700 flex items-center justify-center gap-3 transition-all">
                              <TypeIcon className="w-5 h-5 text-blue-400" /> 문구 편집
                            </button>
                            <button onClick={() => setActiveRefineId(task.id)} className="bg-slate-800/50 hover:bg-slate-700 py-5 rounded-2xl text-[11px] font-black border border-slate-700 flex items-center justify-center gap-3 transition-all">
                              <Sparkles className="w-5 h-5 text-orange-400" /> 세부 보정
                            </button>
                          </div>
                          <button onClick={() => downloadCombined(task)} className="w-full bg-emerald-600 hover:bg-emerald-500 py-6 rounded-[24px] text-xs font-black flex items-center justify-center gap-4 text-white transition-all shadow-2xl shadow-emerald-900/40 active:scale-95 uppercase tracking-[0.2em]">
                            <Download className="w-6 h-6" /> 고화질 마스터 저장
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {task.error && (
                    <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-[24px]">
                      <p className="text-[10px] text-red-400 font-black uppercase mb-2 tracking-[0.2em]">엔진 가동 중단</p>
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
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">도움말</a>
          <button onClick={() => setShowKeyManager(true)} className="hover:text-blue-500 flex items-center gap-4">
            <Key className="w-6 h-6" /> API 설정 관리
          </button>
        </div>
        <div className="flex flex-col items-center gap-5 opacity-40 z-10 relative">
          <p className="text-[11px] text-slate-600 font-black uppercase tracking-[1.2em]">Studio Pro 2025 Edition</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
