export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

export async function searchInternet(query: string, maxResults: number = 4): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        console.warn("[PulsAI Search] TAVILY_API_KEY no configurada.");
        return [];
    }

    try {
        const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: maxResults,
                search_depth: "advanced",
                include_answer: false
            }),
            signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
            console.error(`[PulsAI Search] Error Tavily: ${res.status}`);
            return [];
        }

        const data = await res.json();
        return (data.results || []).map((r: any) => ({
            title: r.title || "Fuente",
            url: r.url || "",
            content: (r.content || r.snippet || "").slice(0, 1000)
        }));
    } catch (e: any) {
        console.error("[PulsAI Search] Error al buscar en Tavily:", e.message);
        return [];
    }
}
