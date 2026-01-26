
import { GoogleGenAI, Type } from "@google/genai";
import { ImageCategory, TransformationOptions } from "../types";

/**
 * 안전하게 API 키를 추출합니다.
 */
const getApiKey = () => {
  try {
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {}

  const saved = localStorage.getItem('GEMINI_API_KEY_ENCRYPTED');
  if (saved) {
    try {
      return atob(saved);
    } catch (e) {
      return "";
    }
  }
  return "";
};

const getAI = () => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API_KEY_MISSING");
  return new GoogleGenAI({ apiKey });
};

export const testConnection = async (tempKey: string): Promise<{success: boolean, message?: string}> => {
  try {
    const ai = new GoogleGenAI({ apiKey: tempKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Hello",
    });
    return { success: !!response.text };
  } catch (error: any) {
    console.error("Connection test failed:", error);
    let message = "유효하지 않은 키입니다.";
    if (error.message?.includes("429")) message = "무료 키 할당량 초과 (잠시 후 시도)";
    if (error.message?.includes("API_KEY_INVALID")) message = "잘못된 API 키 형식입니다.";
    return { success: false, message };
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
  
  // 줌 레벨별 상세 지침
  const zoomPrompts: Record<string, string> = {
    'out-2': '최대한 멀리서 찍은 시네마틱 광각 구도로 넓은 배경이 풍부하게 보이게 해줘.',
    'out-1': '약간 멀리서 피사체와 주변 소품이 조화롭게 보이도록 줌 아웃 구도를 잡아줘.',
    'none': '피사체가 가장 안정적으로 보이는 표준 스튜디오 샷 구도를 적용해줘.',
    'in-1': '피사체의 특징이 잘 드러나도록 가깝게 클로즈업해서 박진감 있게 만들어줘.',
    'in-2': '질감과 디테일이 살아나도록 초근접 매크로 접사 구도로 아주 가깝게 표현해줘.'
  };

  const filterPrompts: Record<string, string> = {
    'food-meat': '육즙이 뚝뚝 떨어지는 듯한 윤기와 그릴 마크의 디테일을 극대화해줘. 붉은 기를 맛있게 살려줘.',
    'food-studio': '고급 레스토랑 매거진 화보처럼 깊이감 있는 그림자와 선명한 대비를 적용해줘.',
    'profile': '부드러운 스튜디오 조명을 사용하여 피부 결은 매끄럽게, 눈동자는 생기 있게 표현해줘.',
    'none': '전체적인 화질과 선명도를 비약적으로 높이고 조명을 입체적으로 재배치해줘.'
  };

  const styleInstruction = filterPrompts[options.filter] || filterPrompts['none'];
  const zoomInstruction = zoomPrompts[options.zoom] || zoomPrompts['none'];

  const prompt = refinement 
    ? `[수정 요청]: "${refinement}". 원본 피사체의 본질은 그대로 유지하면서, 이 요청 사항을 반영하여 훨씬 더 맛있고 선명하게 보정해줘.`
    : `이 사진을 광고 매거진 수준의 초고화질 스튜디오 샷으로 재탄생시켜줘. 
       [카테고리: ${category}, 기본구도: ${options.composition}, 줌레벨: ${zoomInstruction}, 스타일: ${styleInstruction}]. 
       원본의 피사체 형태는 100% 보존하면서, 질감을 더 선명하게(Crispy) 하고, 입체적인 조명을 배치하여 훨씬 더 먹음직스럽고 고급스럽게 보이게 해줘. 
       화면 가득 피사체가 꽉 차거나 여유롭게 배치되는 정도는 [줌레벨] 지침을 엄격히 따라줘.`;

  const targetModel = options.resolution === '1000' 
    ? 'gemini-2.5-flash-image' 
    : 'gemini-3-pro-image-preview';

  try {
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
          { text: prompt }
        ],
      },
      config: {
        imageConfig: { 
          aspectRatio: "1:1",
          imageSize: options.resolution === '2000' ? "2K" : "1K"
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
    if (error.message?.includes("429")) {
      throw new Error("무료 키의 분당 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
    }
    if (error.message?.includes("401") || error.message?.includes("API_KEY")) {
      throw new Error("API 키가 만료되었거나 권한이 없습니다.");
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
