# Lettres jamais envoyées

Un petit site pour écrire les lettres qu'on ne peut plus envoyer, puis les regarder brûler.

On écrit ce qu'on n'a pas pu dire, on clique sur le bouton, et la lettre s'enflamme depuis le coin bas droit du papier. Les flammes montent, la feuille noircit, se perce de trous et s'efface. Il ne reste qu'un message, puis la possibilité d'écrire une nouvelle lettre.

## Confidentialité

Rien n'est envoyé, rien n'est enregistré. Le texte reste dans ton navigateur et disparaît avec le feu. Il n'y a ni serveur, ni compte, ni cookie.

## Fonctionnement

Le site est composé de trois fichiers, sans dépendance ni outil de build :

| Fichier | Rôle |
| --- | --- |
| `index.html` | La structure de la page : titre, papier, boutons, message final |
| `style.css` | L'ambiance, les couleurs, la mise en page et le responsive |
| `script.js` | Le feu : un shader WebGL, plus la logique des boutons |

### L'effet de feu

Au dépôt, la lettre est dessinée sur une image, puis un shader (un petit programme exécuté pour chaque pixel) la consume à partir du coin bas droit. Il calcule, à partir de bruit procédural :

- le front de feu et la braise qui avance sur le papier ;
- les flammes, de la base jaune à la pointe rouge sombre, et les étincelles ;
- la cendre, qui se perce de trous de tailles différentes avant de disparaître.

Si le navigateur ne supporte pas WebGL, la lettre disparaît simplement sans animation.

## Lancer le site en local

Ouvre `index.html` dans un navigateur. Aucune installation n'est nécessaire.

## Personnaliser

Les réglages se trouvent en haut de `script.js` :

- `BURN_DURATION` : la durée de la montée du feu, en secondes ;
- `HOLE_START` et `HOLE_DURATION` : le moment où la cendre commence à se percer, et le temps qu'elle met à disparaître ;
- `MARGIN_TOP` : la hauteur disponible au-dessus du papier pour les flammes.

Les couleurs de la page sont les variables au début de `style.css`, dans `:root`. Le message final se modifie dans `index.html`, dans le bloc `after-message`.

## Mise en ligne

Le site est statique : il se publie tel quel avec GitHub Pages (Settings, puis Pages, branche `main`, dossier racine).

## Technologies

HTML, CSS et JavaScript, avec WebGL pour l'effet de feu.
