const express = require('express');
const cors = require('cors'); 
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
    try {
        const { mediaType, q, genre, exclude_genre, min_score, year, season, episodes, status, manga_type, page } = req.query;
        
        const type = mediaType === 'manga' ? 'manga' : 'anime';
        const url = new URL(`https://api.jikan.moe/v4/${type}`);
        
        url.searchParams.append('limit', '25'); 
        if (page) url.searchParams.append('page', page);

        if (q && q.trim() !== '') {
            url.searchParams.append('q', q.trim());
        } else {
            url.searchParams.append('order_by', 'members');
            url.searchParams.append('sort', 'desc');
        }
        
        if (genre && genre !== '') url.searchParams.append('genres', genre);
        if (exclude_genre && exclude_genre !== '') url.searchParams.append('genres_exclude', exclude_genre);

        // IL FILTRO NATIVO JIKAN (Ora riceverà solo numeri interi dal nostro HTML)
        if (min_score && min_score.trim() !== '') {
            url.searchParams.append('min_score', min_score);
        }
        
        if (status && status !== '') {
            let finalStatus = status;
            if (type === 'manga' && status === 'airing') finalStatus = 'publishing';
            url.searchParams.append('status', finalStatus);
        }

        if (type === 'manga' && manga_type && manga_type !== '') {
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

        const response = await fetch(url.toString());
        
        if (!response.ok) {
            if (response.status === 429) return res.status(429).json({ errore: "Troppe richieste a Jikan. Rallenta!" });
            throw new Error(`Jikan Error: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
             throw new Error("Jikan ha risposto con un formato non valido. Riprova.");
        }

        const data = await response.json();
        let risultati = data.data || [];
        const paginazione = data.pagination;

        // L'unico filtro locale necessario è quello per Episodi, poiché MAL non ha un "max_episodes" nativo
        if (episodes && episodes.trim() !== '') {
            const max = parseInt(episodes);
            risultati = risultati.filter(a => {
                const units = type === 'anime' ? a.episodes : a.chapters;
                return units !== null && units <= max;
            });
        }

        res.json({ anime: risultati, pagination: paginazione });

    } catch (error) {
        console.error("Errore di ricerca:", error);
        res.status(500).json({ errore: error.message || "Internal server error" });
    }
});

app.get('/api/random', async (req, res) => {
    try {
        const { mediaType, genre, exclude_genre, min_score } = req.query;
        const type = mediaType === 'manga' ? 'manga' : 'anime';
        
        let url = `https://api.jikan.moe/v4/${type}?status=complete&order_by=popularity&limit=25`;
        
        if (genre && genre.trim() !== '') url += `&genres=${genre}`;
        if (exclude_genre && exclude_genre.trim() !== '') url += `&genres_exclude=${exclude_genre}`;
        
        // Applica il filtro nativo
        if (min_score && min_score.trim() !== '') url += `&min_score=${min_score}`;

        let response = await fetch(url);
        if (!response.ok) {
            if (response.status === 429) return res.status(429).json({ errore: "Troppe richieste a Jikan. Rallenta!" });
            throw new Error("API Error");
        }
        
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("Jikan ha risposto con HTML.");

        let data = await response.json();
        let list = data.data || [];

        if (list.length === 0) return res.status(404).json({ errore: "Nessun risultato trovato con questo voto o filtri." });

        // TRUE RANDOM
        const lastPage = data.pagination?.last_visible_page || 1;
        const randPage = Math.floor(Math.random() * lastPage) + 1;

        if (randPage !== 1) {
            response = await fetch(`${url}&page=${randPage}`);
            data = await response.json();
            list = data.data || [];
        }

        if (list.length === 0) return res.status(404).json({ errore: "Errore durante la pesca randomica." });

        const randomIndex = Math.floor(Math.random() * list.length);
        res.json(list[randomIndex]);

    } catch (error) {
        console.error("Random Error:", error);
        res.status(500).json({ errore: error.message || "Random fetch failed." });
    }
});

app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));