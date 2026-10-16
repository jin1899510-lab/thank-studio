<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1g_qf8vH2U0NpfwRUI1YdsP1IbFCBxuTk

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Mirra 자동 발행 도구

영상 분석 → 캡션·해시태그 작성 → Mirra 를 통한 SNS 지금 발행까지 한 번에 처리하는 프로그램은
[`mirra-publisher/`](mirra-publisher/README.md) 폴더에 있습니다.
