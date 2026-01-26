
import React, { useRef } from 'react';
import { Upload, Plus, AlertCircle, Package } from 'lucide-react';

interface ImageUploaderProps {
  onUpload: (files: FileList) => void;
  disabled?: boolean;
  count: number;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onUpload, disabled, count }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`relative group border-2 border-dashed rounded-2xl p-8 transition-all duration-300
        ${disabled ? 'border-slate-800 bg-slate-900/30 cursor-not-allowed' : 'border-slate-700 hover:border-blue-500 bg-slate-800/20 cursor-pointer hover:bg-slate-800/40'}
      `}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input 
        type="file" 
        ref={inputRef}
        onChange={handleFileChange}
        className="hidden" 
        multiple 
        accept="image/*,.zip"
        disabled={disabled}
      />
      
      <div className="flex flex-col items-center justify-center text-center gap-4">
        <div className={`p-4 rounded-full transition-colors ${disabled ? 'bg-slate-800' : 'bg-blue-500/10 group-hover:bg-blue-500/20'}`}>
          <Upload className={`w-8 h-8 ${disabled ? 'text-slate-600' : 'text-blue-500'}`} />
        </div>
        
        <div>
          <p className="text-lg font-semibold text-slate-200">
            {disabled ? '업로드 한도 초과' : '사진 또는 ZIP 파일을 드래그하거나 클릭하여 업로드'}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            이미지 개별 파일 또는 <span className="text-blue-400 font-medium">ZIP 압축 파일</span>(최대 100장)을 지원합니다.
          </p>
        </div>

        {count > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-sm font-medium">
            <Plus className="w-3 h-3" />
            <span>{count} / 100개 대기 중</span>
          </div>
        )}
      </div>

      {disabled && (
        <div className="absolute top-4 right-4 text-amber-500 flex items-center gap-1 text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>최대 개수 도달</span>
        </div>
      )}
      
      {!disabled && (
        <div className="absolute bottom-4 right-4 text-slate-500 flex items-center gap-1 text-[10px] uppercase font-bold tracking-tighter opacity-50">
          <Package className="w-3 h-3" />
          <span>ZIP 압축파일 지원됨</span>
        </div>
      )}
    </div>
  );
};
