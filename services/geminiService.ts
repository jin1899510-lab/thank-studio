
import { GoogleGenAI, Type } from "@google/genai";
import { ImageCategory, TransformationOptions } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    ? `사용자 추가 요청을 반영하여 이미지를 수정하세요: "${refinement}". 원본 피사체의 특징은 유지하되 품질을 높이세요.`
    : `이 사진을 전문가용 스튜디오 샷으로 변환하세요. 카테고리: ${category}, 구도: ${options.composition}, 필터: ${options.filter}. 원본 피사체는 보존하되 조명과 질감을 광고 사진 수준으로 개선하세요.`;

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

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("이미지 생성 결과가 없습니다.");
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) {
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
