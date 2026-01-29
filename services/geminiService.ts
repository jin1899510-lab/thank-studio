
import { GoogleGenAI } from "@google/genai";
import { ImageCategory, TransformationOptions } from "../types";

// Always create a new instance right before use with process.env.API_KEY
// per the guidelines to ensure the most up-to-date key is used.

export const analyzeImageCategory = async (base64Image: string): Promise<ImageCategory> => {
  // Create instance right before making an API call
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
        { text: "Analyze this image and categorize it as: 'People', 'Food', 'Design', 'Profile', 'FoodStudio', or 'Other'. Respond ONLY with the category name." }
      ]
    }
  });
  return (response.text?.trim() || 'Other') as ImageCategory;
};

export const transformImage = async (
  base64Image: string, 
  category: ImageCategory,
  options: TransformationOptions,
  refinement?: string
): Promise<string> => {
  // Create instance right before making an API call
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const zoomPrompts: Record<string, string> = {
    'out-2': '최대 광각 구도로 피사체와 넓은 배경을 담아줘.',
    'out-1': '여유가 있는 줌 아웃 구도로 전체를 보여줘.',
    'none': '표준 스튜디오 화보 구도를 적용해줘.',
    'in-1': '가깝게 확대하여 디테일을 강조해줘.',
    'in-2': '초근접 매크로 접사 구도로 질감을 살려줘.'
  };

  const filterPrompts: Record<string, string> = {
    'food-meat': '육즙의 윤기와 고기의 질감을 광고 사진처럼 극대화해줘.',
    'food-studio': '고급 푸드 화보 스타일의 조명과 대비를 적용해줘.',
    'profile': '인물의 피부는 매끄럽게, 이목구비는 선명하게 표현해줘.',
    'none': '화질을 극상으로 높이고 색감을 풍부하게 보정해줘.'
  };

  const styleInstruction = filterPrompts[options.filter] || filterPrompts['none'];
  const zoomInstruction = zoomPrompts[options.zoom] || zoomPrompts['none'];

  const prompt = refinement 
    ? `[보정 요청]: "${refinement}". 원본 피사체를 유지하며 화질을 비약적으로 높여줘.`
    : `이 사진을 상업용 광고 화질로 변환해줘. 
       [카테고리: ${category}, 스타일: ${styleInstruction}, 구도: ${zoomInstruction}]. 
       노이즈를 제거하고 디테일을 비약적으로 높여서 훨씬 더 맛있고 선명하게 만들어줘.`;

  const targetModel = options.resolution === '2000' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';

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
    throw new Error("결과 이미지를 받지 못했습니다.");
  } catch (error: any) {
    console.error("Transform API Error:", error);
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
