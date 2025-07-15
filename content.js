// function getArticleText() {
//   const article = document.querySelector("article");
//   if (article) return article.innerText;

//   const paragraphs = Array.from(document.querySelectorAll("p"));
//   return paragraphs.map((p) => p.innerText).join("\n");
// }

// chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
//   if (req.type === "GET_ARTICLE_TEXT") {
//     const text = getArticleText();
//     sendResponse({ text });
//   }
// });

// content.js

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "GET_TRANSCRIPT_IN_PAGE") {
    const handleTranscriptResponse = (event) => {
      if (
        event.source === window &&
        event.data &&
        event.data.type === "TRANSCRIPT_RESPONSE"
      ) {
        window.removeEventListener("message", handleTranscriptResponse);

        // FIX: Wrap sendResponse to delay response
        setTimeout(() => {
          sendResponse({ text: event.data.text || "" });
        }, 0);
      }
    };

    window.addEventListener("message", handleTranscriptResponse);

    const script = document.createElement("script");
    script.textContent = `(${fetchTranscriptFromPage.toString()})();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    return true; // Needed to keep message channel alive
  }

  if (req.type === "GET_ARTICLE_TEXT") {
    const article = document.querySelector("article");
    if (article) return sendResponse({ text: article.innerText });

    const paragraphs = Array.from(document.querySelectorAll("p"));
    const text = paragraphs.map((p) => p.innerText).join("\n");
    sendResponse({ text });
  }
});


function fetchTranscriptFromPage() {
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

      const track = tracks.find((t) => t.languageCode === "en") || tracks[0];
      const xml = await fetch(track.baseUrl).then((res) => res.text());
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const transcript = Array.from(doc.querySelectorAll("text"))
        .map((t) => t.textContent.trim())
        .join("\n");

      window.postMessage({ type: "TRANSCRIPT_RESPONSE", text: transcript }, "*");
    } catch (e) {
      console.error("Transcript error:", e);
      window.postMessage({ type: "TRANSCRIPT_RESPONSE", text: "" }, "*");
    }
  })();
}












