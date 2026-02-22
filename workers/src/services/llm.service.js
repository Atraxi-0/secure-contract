const { GoogleGenerativeAI } = require("@google/generative-ai");

// Fetch key from process.env
const apiKey = process.env.GEMINI_API_KEY;

// Initialize ONLY if key exists
let genAI = null;
let model = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

async function generateNarration(toolOutput, previousContext = "") {
  // If no API Key, return a clean "Demo Mode" response
  if (!model) {
    return "🚀 [Demo Mode] Slither found potential vulnerabilities in your contract. (Pro-tip: Add your GEMINI_API_KEY to see real AI-powered security advice here!)";
  }

  try {
    if (!toolOutput.success) {
      return `The analysis tool encountered an error: ${toolOutput.error}. No findings to analyze.`;
    }

    const detectors = toolOutput.data?.results?.detectors || [];
    if (detectors.length === 0) return "✅ Slither analyzed the contract and found no major vulnerabilities. Great job!";

    const prompt = `
      As a Smart Contract Security Expert, analyze these Slither findings:
      ${JSON.stringify(detectors.slice(0, 5))} 
      
      Provide a concise summary (max 100 words) for a developer explaining the risks and how to fix them.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Gemini Error:", error.message);
    return "The AI is currently analyzing the findings. Raw results are stored in the database.";
  }
}

module.exports = { generateNarration };