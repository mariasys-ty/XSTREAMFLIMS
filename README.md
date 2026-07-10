🎬 Xstream Movies

A modern, fast, and responsive video streaming web application. Built with vanilla HTML, CSS, and JavaScript, powered by Firebase for the backend, and Backblaze B2 for reliable, large-file media storage.

FirebaseBackblazeJavaScriptHTML5CSS3

✨ Features

🎥 User Experience

Dynamic Video Streaming: Smooth HTML5 video player with mobile support (playsinline).
OMDb Integration: Automatically fetches movie posters, IMDB ratings, runtime, and genre when uploading.
Live TV: Dedicated section for streaming live television channels.
Translated Movies: Separate category for dubbed/translated content.
Offline Downloads: Download movies locally using IndexedDB for offline viewing.
Search & Filters: Advanced filtering by category, sorting by trending/views/likes, and full-text search.
👤 User Accounts

Authentication: Secure login/signup via Email/Password and Google Sign-In.
User Profiles: Dashboard showing watch history, favourites, and downloaded movies.
Like/Dislike System: Engage with content with persistent state.
Watch History: Automatic tracking of viewed movies.
🛠️ Admin & Backend

Large File Uploads: Multipart upload API supporting files up to 10GB reliably.
Direct Database Writes: Instant metadata saving to Firebase Realtime Database.
Maintenance Mode: Toggle maintenance mode from the database to restrict access to admins only.
🚀 Performance & SEO

Lazy Loading: Images load only when they enter the viewport.
SEO Ready: Includes sitemap.xml, robots.txt, and dynamic meta tags.
Analytics Ready: Built-in client-side tracking system (SiteAnalytics).
🛠️ Tech Stack

Layer	Technology
Frontend	HTML5, CSS3, Vanilla JavaScript (ES6+)
Database	Firebase Realtime Database
Authentication	Firebase Authentication
Media Storage	Backblaze B2 Cloud Storage
Metadata API	OMDb API
Offline Storage	IndexedDB
