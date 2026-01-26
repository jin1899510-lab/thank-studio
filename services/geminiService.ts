
import { GoogleGenAI, Type } from "@google/genai";
import { ImageCategory, TransformationOptions } from "../types";

/**
 * 안전하게 API 키를 추출합니다.
 */
const getApiKey = () => {
  // 1. AI Studio 내부 환경 체크
  try {
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {}

  // 2. localStorage에서 복호화하여 가져오기
  const saved = localStorage.getItem('GEMINI_API_KEY_ENCRYPTED');
  if (saved) {
    try {
      return atob(saved); // Simple base64 decode for obfuscation
    } catch (e) {
      return "";
    }
  }
  return "";
};

/**
 * 최신 API 키가 적용된 AI 인스턴스를 반환합니다.
 */
const getAI = () => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API_KEY_MISSING");
  return new GoogleGenAI({ apiKey });
};

/**
 * API 키 연결 테스트 (Ping)
 */
export const testConnection = async (tempKey: string): Promise<boolean> => {
  try {
    // 테스트용 인스턴스 직접 생성
    const ai = new GoogleGenAI({ apiKey: tempKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite-latest",
      contents: "ping",
    });
    return !!response.text;
  } catch (error) {
    console.error("Connection test failed:", error);
    return false;
  }
};

export const analyzeImageCategory = async (base64Image: string): Promise<ImageCategory> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
        { text: "Analyze this image and categorize it as exactly one of: 'People', 'Food', 'Design', 'Profile', 'FoodStudio', or 'Other'. Respond ONLY with the category name." }
      ]
    }
  });
  return (response.text?.trim() || 'Other') as ImageCategory;
};

export const recommendTextColor = async (base64Image: string): Promise<string> => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
          { text: "Suggest one best HEX color for text on this image background. Return ONLY the hex code like #FFFFFF." }
        ]
      }
    });
    return response.text?.trim() || "#FFFFFF";
  } catch {
    return "#FFFFFF";
  }
};

export const transformImage = async (
  base64Image: string, 
  category: ImageCategory,
  options: TransformationOptions,
  refinement?: string
): Promise<string> => {
  const ai = getAI();
  
  const prompt = refinement 
    ? `수정 요청 사항: "${refinement}". 원본 피사체의 구도와 형태를 유지하면서 요청한 부분만 전문가급 화질로 수정해줘.`
    : `이 사진을 전문가용 스튜디오 샷으로 변환해줘. 카테고리: ${category}, 구도: ${options.composition}, 스타일: ${options.filter}. 원본 피사체는 보존하고 조명과 질감을 광고 수준으로 개선해줘.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
          { text: prompt }
        ],
      },
      config: {
        imageConfig: { 
          aspectRatio: "1:1",
          imageSize: options.resolution === '1000' ? "1K" : "2K"
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("이미지 생성 결과가 없습니다.");
  } catch (error: any) {
    if (error.message?.includes("401") || error.message?.includes("API_KEY")) {
      throw new Error("API_KEY_EXPIRED");
    }
    throw error;
  }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};
