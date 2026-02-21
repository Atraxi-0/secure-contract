"use strict";

require("dotenv").config({ path: "../../.env" });

/**
 * LLMService — Provider-agnostic wrapper for LLM narration.
 *
 * Controlled by two .env variables:
 *   LLM_PROVIDER   = "anthropic" | "gemini"   (default: "anthropic")
 *   ANTHROPIC_API_KEY / GEMINI_API_KEY
 *
 * Usage:
 *   const llm = new LLMService();
 *   const text = await llm.generateNarration(toolData, previousContext);
 */
class LLMService {
  constructor() {
    this.provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

    if (this.provider === "anthropic") {
      // Lazy-load so the service doesn't crash if the package isn't installed
      // when the dev is using Gemini.
      const Anthropic = require("@anthropic-ai/sdk");
      this.client = new Anthropic.default({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      this.model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";
    } else if (this.provider === "gemini") {
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.client = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-1.5-pro",
      });
    } else {
      throw new Error(
        `Unsupported LLM_PROVIDER: "${this.provider}". Use "anthropic" or "gemini".`,
      );
    }
  }

  /**
   * Build a structured prompt from tool output and any prior narration context.
   * @param {Object} toolData        - Raw output from Slither / Mythril / Forge / GNN.
   * @param {string} previousContext - Concatenated prior stage narrations (may be empty).
   * @returns {string}
   */
  _buildPrompt(toolData, previousContext) {
    const contextSection = previousContext
      ? `## Prior Analysis Context\n${previousContext}\n\n`
      : "";

    return `You are an expert smart-contract security auditor delivering an incremental security report.
A security tool has just finished running. Narrate its findings clearly for a developer audience.
Highlight critical vulnerabilities, explain *why* they are dangerous, and suggest remediation.
Be concise — this is one stage of a multi-stage analysis.

${contextSection}## Tool Output (JSON)
\`\`\`json
${JSON.stringify(toolData, null, 2)}
\`\`\`

Provide your narration now:`;
  }

  /**
   * Generate a narration string for a single analysis stage.
   *
   * @param {Object} toolData        - Raw JSON output from the security tool.
   * @param {string} [previousContext=''] - Accumulated narration from previous stages.
   * @returns {Promise<string>}      - The LLM's narration text.
   */
  async generateNarration(toolData, previousContext = "") {
    const prompt = this._buildPrompt(toolData, previousContext);

    if (this.provider === "anthropic") {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      // content[0].text is the standard response shape for Anthropic SDK
      return response.content[0].text;
    }

    if (this.provider === "gemini") {
      const result = await this.client.generateContent(prompt);
      return result.response.text();
    }

    // Should never reach here due to constructor guard, but kept for safety.
    throw new Error("LLM provider not initialised correctly.");
  }
}

module.exports = new LLMService(); // Export singleton
