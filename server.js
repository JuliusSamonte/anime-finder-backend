const express = require('express');
const cors = require('cors'); 
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.static('public'));

// 🚀 NUOVO: Sistema di Retry per gestire i capricci di Jikan API
async function fetchWithRetry(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            
            if (response.ok) return response;
            
            if (response.status === 429) {
                console.warn(`[Rate Limit] Troppe richieste. Riprovo in ${backoff * 2}ms...`);
                await new Promise(r => setTimeout(r, backoff * 2));
                continue;
            }
            if (response.status >= 500) {
                console.warn(`[Jikan 50x Error] Timeout del server. Riprovo in ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }
            
            // Se è un errore 400 o 404, non ha senso riprovare
            throw new Error(`Errore API: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error; // Lancia l'errore se abbiamo finito i tentativi
            await new Promise(r => setTimeout(r, backoff));
        }
    }
    throw new Error("Jikan API non risponde dopo vari tentativi. Riprova più tardi.");
}

app.get('/api/search', async (req, res) => {
    try {
        const { mediaType, q, genre, exclude_genre, min_score, year, season, episodes, status, manga_type, page } = req.query;
        
        const type = mediaType === 'manga' ? 'manga' : 'anime';
        const url = new URL(`https://api.jikan.moe/v4/${type}`);
        
        url.searchParams.append('limit', '25'); 
        if (page) url.searchParams.append('page', page);

        const hasQuery = q && q.trim() !== '';
        const hasMinScore = min_score && min_score.trim() !== '';

        if (hasQuery) {
            url.searchParams.append('q', q.trim());
        } else {
            // FIX: Usare 'popularity' invece di 'members' è molto più stabile sui server Jikan
            if (hasMinScore) {
                url.searchParams.append('order_by', 'score');
            } else {
                url.searchParams.append('order_by', 'popularity');
            }
            url.searchParams.append('sort', 'desc');
        }
        
        if (genre) url.searchParams.append('genres', genre);
        if (exclude_genre) url.searchParams.append('genres_exclude', exclude_genre);
        if (hasMinScore) url.searchParams.append('min_score', min_score.trim());
        
        if (status) {
            let finalStatus = status;
            if (type === 'manga' && status === 'airing') finalStatus = 'publishing';
            url.searchParams.append('status', finalStatus);
        }

        if (type === 'manga' && manga_type) {
            url.searchParams.append('type', manga_type);
        }

        if (year && year.trim() !== '') {
            let startDate = `${year}-01-01`;
            let endDate = `${year}-12-31`;

            if (type === 'anime' && season) {
                if (season === 'winter') { startDate = `${year}-01-01`; endDate = `${year}-03-31`; }
                else if (season === 'spring') { startDate = `${year}-04-01`; endDate = `${year}-06-30`; }
                else if (season === 'summer') { startDate = `${year}-07-01`; endDate = `${year}-09-30`; }
                else if (season === 'fall') { startDate = `${year}-10-01`; endDate = `${year}-12-31`; }
            }
            url.searchParams.append('start_date', startDate);
            url.searchParams.append('end_date', endDate);
        }

        // Usiamo la nuova funzione con retry
        const response = await fetchWithRetry(url.toString());
        
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Jikan ha risposto con un formato non valido.");
        }

        const data = await response.json();
        let risultati = data.data || [];
        const paginazione = data.pagination;

        if (episodes && episodes.trim() !== '') {
            const max = parseInt(episodes);
            risultati = risultati.filter(a => {
                const units = type === 'anime' ? a.episodes : a.chapters;
                return units !== null && units <= max;
            });
        }

        res.json({ anime: risultati, pagination: paginazione });

    } catch (error) {
        console.error("Errore di ricerca:", error.message);
        res.status(500).json({ errore: error.message || "Internal server error" });
    }
});

app.get('/api/random', async (req, res) => {
    try {
        const { mediaType, genre, exclude_genre, min_score } = req.query;
        const type = mediaType === 'manga' ? 'manga' : 'anime';
        
        const hasMinScore = min_score && min_score.trim() !== '';
        const orderBy = hasMinScore ? 'score' : 'popularity';
        
        const url = new URL(`https://api.jikan.moe/v4/${type}`);
        url.searchParams.append('status', 'complete');
        url.searchParams.append('order_by', orderBy);
        url.searchParams.append('sort', 'desc');
        url.searchParams.append('limit', '25');

        if (genre) url.searchParams.append('genres', genre);
        if (exclude_genre) url.searchParams.append('genres_exclude', exclude_genre);
        if (hasMinScore) url.searchParams.append('min_score', min_score.trim());

        let response = await fetchWithRetry(url.toString());
        let data = await response.json();
        let list = data.data || [];

        if (list.length === 0) return res.status(404).json({ errore: "Nessun risultato trovato con questi filtri." });

        // FIX: Limita la pagina massima a 10 per evitare il blocco per Deep Pagination di Jikan/MAL
        const lastPage = data.pagination?.last_visible_page || 1;
        const safeLastPage = Math.min(lastPage, 10); 
        const randPage = Math.floor(Math.random() * safeLastPage) + 1;

        if (randPage !== 1) {
            url.searchParams.set('page', randPage);
            response = await fetchWithRetry(url.toString());
            data = await response.json();
            list = data.data || [];
        }

        if (list.length === 0) return res.status(404).json({ errore: "Errore durante la pesca randomica." });

        const randomIndex = Math.floor(Math.random() * list.length);
        res.json(list[randomIndex]);

    } catch (error) {
        console.error("Random Error:", error.message);
        res.status(500).json({ errore: error.message || "Random fetch failed." });
    }
});

app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));