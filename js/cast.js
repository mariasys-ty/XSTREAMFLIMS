// 1. Prevent Firebase from loading twice
if (!firebase.apps.length) {
 const firebaseConfig = {
  apiKey: "AIzaSyCvrWHOHXmVmHkl451aQA6XFCWy7xA9jFw",
  authDomain: "xstream-9f21e.firebaseapp.com",
  // ⚠️ CRITICAL FIX: Your config was missing this line!
  databaseURL: "https://xstream-9f21e-default-rtdb.firebaseio.com",
  projectId: "xstream-9f21e",
  storageBucket: "xstream-9f21e.firebasestorage.app",
  messagingSenderId: "179015046758",
  appId: "1:179015046758:web:e7da8143826b59b49e7fa7",
  measurementId: "G-RN9E44VEFY"
 };
 firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// 2. Get the cast name from the URL (e.g., cast.html?n=John%20Wick)
const params = new URLSearchParams(window.location.search);
const castQueryParam = params.get('n');

// 3. THE NULL FIX: If there is no name in the URL, kick them back to the homepage
if (!castQueryParam) {
 alert("No cast member selected!");
 window.location.href = 'index.html';
 throw new Error("Stopping script: No name provided in URL.");
}

const castName = decodeURIComponent(castQueryParam);

// 4. Update the page title and header
document.title = `${castName} Movies - XSTREAM`;
document.getElementById('castName').innerText = castName;
document.getElementById('loader').style.display = 'none';
document.getElementById('castName').style.display = 'block';

const container = document.getElementById('movieSections');

// 5. Function to fetch and display movies from a specific node
function fetchMovies(nodeName, targetType) {
 db.ref(nodeName).once('value')
  .then(snapshot => {
   const movies = snapshot.val();
   let html = '';
   let count = 0;
   
   if (movies) {
    for (let key in movies) {
     const movie = movies[key];
     
     // Searches the 'director' field. Make sure spelling matches Firebase exactly!
     if (movie.director && movie.director.toLowerCase().includes(castName.toLowerCase())) {
      
      count++;
      // Determine the correct redirect URL based on your rules
      let redirectUrl = '';
      if (targetType === 'video') {
       redirectUrl = `video.html?id=${key}`;
      } else if (targetType === 'watch') {
       redirectUrl = `watch.html?id=${key}`;
      }
      
      html += `
                            <a href="${redirectUrl}" style="text-decoration: none; color: inherit;">
                                <div class="movie-card">
                                    <img src="${movie.thumbnailUrl}" alt="${movie.title}" onerror="this.src='default-poster.png'">
                                    <h3>${movie.title}</h3>
                                </div>
                            </a>
                        `;
     }
    }
   }
   
   // Only add the section to the page if movies were found
   if (count > 0) {
    container.innerHTML += `
                    <h2 class="section-title">Found in ${nodeName} (${count})</h2>
                    <div class="movie-grid">${html}</div>
                `;
   }
  })
  .catch(error => {
   console.error("Error fetching data: ", error);
  });
}

// 6. Run the function for all 3 nodes with their specific redirect rules
fetchMovies('Translated', 'video');
fetchMovies('description', 'video');
fetchMovies('Series', 'watch');