
import React, { useState } from 'react';
import { ImageItem, ZoomLevel } from '../types';
import { CheckCircle2, Loader2, AlertCircle, Trash2, Download, Send, RotateCcw, ZoomIn, Sparkles, Search, Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageGridProps {
  images: ImageItem[];
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  onRefine: (id: string, prompt: string) => void;
  onUndo: (id: string) => void;
  onZoomChange: (id: string, zoom: ZoomLevel) => void;
  isGlobalProcessing: boolean;
}

export const ImageGrid: React.FC<ImageGridProps> = ({ images, onRemove, onDownload, onRefine, onUndo, onZoomChange, isGlobalProcessing }) => {
  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-8 justify-center justify-items-center w-full">
      {images.map((img) => (
        <ImageCard 
          key={img.id} 
          img={img} 
          onRemove={onRemove} 
          onDownload={onDownload} 
          onRefine={onRefine}
          onUndo={onUndo}
          onZoomChange={onZoomChange}
          isDisabled={isGlobalProcessing}
        />
      ))}
    </div>
  );
};

const RECOMMENDED_PROMPTS = [
  { label: "🥘 육즙 가득 스테이크", prompt: "고기의 육즙을 강조하고 표면의 그릴 질감과 윤기를 극대화해줘." },
  { label: "🍞 갓 구운 빵의 온기", prompt: "빵의 바삭한 겉면 질감을 살리고 따뜻한 골든 브라운 톤을 강화해줘." },
  { label: "🍓 상큼한 과일 디저트", prompt: "과일의 색감을 생생하게 하고 소스의 반짝이는 광택을 추가해줘." },
  { label: "👤 완벽한 인물 프로필", prompt: "배경을 부드럽게 정리하고 피부 결을 도자기처럼 매끄럽게 보정해줘." },
  { label: "💎 럭셔리 제품 광택", prompt: "피사체의 재질감을 강조하고 전문 스튜디오의 드라마틱한 조명을 써줘." }
];

const ImageCard: React.FC<{ 
  img: ImageItem, 
  onRemove: (id: string) => void, 
  onDownload: (id: string) => void,
  onRefine: (id: string, prompt: string) => void,
  onUndo: (id: string) => void,
  onZoomChange: (id: string, zoom: ZoomLevel) => void,
  isDisabled: boolean
}> = ({ img, onRemove, onDownload, onRefine, onUndo, onZoomChange, isDisabled }) => {
  const [refineText, setRefineText] = useState('');

  const handleSubmitRefine = (e: React.FormEvent) => {
    e.preventDefault();
    if (refineText.trim()) {
      onRefine(img.id, refineText);
      setRefineText('');
    }
  };

  const hasHistory = img.history && img.history.length > 0;

  return (
    <div className="group relative bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden transition-all hover:ring-2 hover:ring-blue-500/50 w-full max-w-sm mx-auto flex flex-col shadow-xl">
      {/* 액션 버튼 */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button 
          onClick={() => onRemove(img.id)}
          className="bg-slate-900/80 text-white p-1.5 rounded-full hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100 shadow-lg"
          disabled={isDisabled}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 이미지 미리보기 */}
      <div className="aspect-square relative overflow-hidden bg-slate-900 flex items-center justify-center">
        {img.processedUrl ? (
          <img 
            src={img.processedUrl} 
            alt="변환 완료" 
            className="w-full h-full object-cover block mx-auto animate-in fade-in duration-700"
          />
        ) : (
          <img 
            src={img.previewUrl} 
            alt="원본" 
            className={`w-full h-full object-cover block mx-auto transition-opacity duration-300 ${img.status !== 'idle' ? 'opacity-40' : ''}`} 
          />
        )}

        {(img.status === 'analyzing' || img.status === 'processing') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-[4px]">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
            <span className="text-sm font-bold text-white tracking-widest uppercase animate-pulse">Transforming...</span>
          </div>
        )}
      </div>

      {/* 조작 패널 */}
      <div className="p-3 bg-slate-900/80 border-t border-slate-800 flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[10px] text-slate-500 truncate flex-1 font-mono tracking-tighter">{img.originalName}</span>
          <div className="flex items-center gap-1">
            {img.status === 'completed' && hasHistory && (
              <button onClick={() => onUndo(img.id)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-all" title="되돌리기" disabled={isDisabled}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            {img.status === 'completed' && (
              <button onClick={() => onDownload(img.id)} className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors" title="다운로드">
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {img.status === 'completed' && (
          <div className="space-y-3">
            {/* 개별 5단계 줌 컨트롤 */}
            <div className="flex items-center justify-between gap-1 bg-slate-950/50 p-1 rounded-lg border border-slate-800">
              <span className="text-[9px] font-bold text-slate-500 ml-1 uppercase">ZOOM</span>
              <div className="flex gap-0.5">
                <button 
                  onClick={() => onZoomChange(img.id, 'out-2')}
                  className={`p-1 rounded-md transition-all ${img.currentZoom === 'out-2' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                  title="최대 축소"
                  disabled={isDisabled}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button 
                  onClick={() => onZoomChange(img.id, 'out-1')}
                  className={`p-1 rounded-md transition-all ${img.currentZoom === 'out-1' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                  title="축소"
                  disabled={isDisabled}
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button 
                  onClick={() => onZoomChange(img.id, 'none')}
                  className={`p-1 rounded-md transition-all ${img.currentZoom === 'none' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                  title="표준"
                  disabled={isDisabled}
                >
                  <Search className="w-3 h-3" />
                </button>
                <button 
                  onClick={() => onZoomChange(img.id, 'in-1')}
                  className={`p-1 rounded-md transition-all ${img.currentZoom === 'in-1' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                  title="확대"
                  disabled={isDisabled}
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button 
                  onClick={() => onZoomChange(img.id, 'in-2')}
                  className={`p-1 rounded-md transition-all ${img.currentZoom === 'in-2' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}
                  title="최대 확대"
                  disabled={isDisabled}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* 추천 프롬프트 태그 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                <Sparkles className="w-3 h-3 text-orange-400" />
                개별 최적화 가이드
              </div>
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar p-0.5">
                {RECOMMENDED_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => onRefine(img.id, item.prompt)}
                    disabled={isDisabled}
                    className="text-[9px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-400 hover:text-white rounded transition-all whitespace-nowrap"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmitRefine} className="relative">
              <input 
                type="text" 
                placeholder="추가 요청 입력..." 
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                disabled={isDisabled}
                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg pl-3 pr-10 py-1.5 text-[11px] text-slate-200 outline-none focus:border-blue-500"
              />
              <button type="submit" disabled={!refineText.trim() || isDisabled} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-400">
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}

        {img.error && (
          <div className="bg-red-500/10 border border-red-500/20 p-2 rounded-lg mt-1">
            <p className="text-[10px] text-red-400 leading-tight flex items-start gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {img.error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
