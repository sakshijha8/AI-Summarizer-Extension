document.getElementById("summarize").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  resultDiv.innerHTML = '<div class="loading"><div class="loader"></div></div>';

  const summaryTypeSelector = document.getElementById("summary-type");
  const summaryType = summaryTypeSelector ? summaryTypeSelector.value : "brief";

  chrome.storage.sync.get(["geminiApiKey"], async (result) => {
    if (!result.geminiApiKey) {
      resultDiv.innerText = "❌ API key not found. Please set your Gemini API key in options.";
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      const tabUrl = tab.url || "";
      const isYouTube = tabUrl.includes("youtube.com/watch");

      if (isYouTube) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            func: () => {
              const waitForPlayerResponse = () => {
                return new Promise((resolve, reject) => {
                  const maxRetries = 10;
                  let attempts = 0;
                  const check = () => {
                    const response = window.ytInitialPlayerResponse;
                    if (response) return resolve(response);
                    attempts++;
                    if (attempts >= maxRetries) return reject("ytInitialPlayerResponse not found");
                    setTimeout(check, 500);
                  };
                  check();
                });
              };

              (async () => {
                try {
                  const playerResponse = await waitForPlayerResponse();
                  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                  if (!tracks || tracks.length === 0) {
                    window.postMessage({ type: "TRANSCRIPT_RESPONSE", text: "" }, "*");
                    return;
                  }
                  const track = tracks.find(t => t.languageCode === "en") || tracks[0];
                  const xml = await fetch(track.baseUrl).then(res => res.text());
                  const doc = new DOMParser().parseFromString(xml, "application/xml");
                  const transcript = Array.from(doc.querySelectorAll("text"))
                    .map(el => el.textContent.trim())
                    .join("\n");

                  window.postMessage({ type: "TRANSCRIPT_RESPONSE", text: transcript }, "*");
                } catch (err) {
                  console.error("Error fetching transcript:", err);
                  window.postMessage({ type: "TRANSCRIPT_RESPONSE", text: "" }, "*");
                }
              })();
            }
          },
          () => {
            if (chrome.runtime.lastError) {
              resultDiv.innerText = `❌ ${chrome.runtime.lastError.message}`;
              return;
            }

            // Wait for transcript response from injected script
            const listener = (event) => {
              if (
                event.source === window &&
                event.data &&
                event.data.type === "TRANSCRIPT_RESPONSE"
              ) {
                window.removeEventListener("message", listener);
                const transcript = event.data.text || "";
                if (!transcript.trim()) {
                  resultDiv.innerText = "⚠️ No transcript found for this YouTube video.";
                } else {
                  getGeminiSummary(transcript, summaryType, result.geminiApiKey)
                    .then((summary) => (resultDiv.innerText = summary))
                    .catch((err) => (resultDiv.innerText = `❌ Error: ${err.message}`));
                }
              }
            };

            window.addEventListener("message", listener);
          }
        );
      }
      else {
        // 🌐 Regular web page text extraction
        chrome.tabs.sendMessage(tab.id, { type: "GET_ARTICLE_TEXT" }, async (res) => {
          if (chrome.runtime.lastError) {
            resultDiv.innerText = `❌ ${chrome.runtime.lastError.message}`;
            return;
          }

          if (!res || !res.text || res.text.trim() === "") {
            resultDiv.innerText = "⚠️ No article text found.";
            return;
          }

          try {
            const summary = await getGeminiSummary(res.text, summaryType, result.geminiApiKey);
            resultDiv.innerText = summary;
          } catch (error) {
            resultDiv.innerText = `❌ Error: ${error.message || "Summary failed."}`;
          }
        });
      }
    });
  });
});

document.getElementById("copy-btn").addEventListener("click", () => {
  const summaryText = document.getElementById("result").innerText;

  if (summaryText && summaryText.trim() !== "") {
    navigator.clipboard
      .writeText(summaryText)
      .then(() => {
        const copyBtn = document.getElementById("copy-btn");
        const originalText = copyBtn.innerText;

        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          copyBtn.innerText = originalText;
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
      });
  }
});

async function getGeminiSummary(text, summaryType, apiKey) {
  // Truncate very long texts to avoid API limits (typically around 30K tokens)
  const maxLength = 20000;
  const truncatedText =
    text.length > maxLength ? text.substring(0, maxLength) + "..." : text;

  let prompt;
  switch (summaryType) {
    case "brief":
      prompt = `Provide a brief summary of the following article in 2-3 sentences:\n\n${truncatedText}`;
      break;
    case "detailed":
      prompt = `Provide a detailed summary of the following article, covering all main points and key details:\n\n${truncatedText}`;
      break;
    case "bullets":
      prompt = `Summarize the following article in 5-7 key points. Format each point as a line starting with "- " (dash followed by a space). Do not use asterisks or other bullet symbols, only use the dash. Keep each point concise and focused on a single key insight from the article:\n\n${truncatedText}`;
      break;
    default:
      prompt = `Summarize the following article:\n\n${truncatedText}`;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        }),
      }
    );

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error?.message || "API request failed");
    }

    const data = await res.json();
    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No summary available."
    );
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to generate summary. Please try again later.");
  }
}