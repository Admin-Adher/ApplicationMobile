# Récupération des visites historiques hors ligne

Les clients antérieurs au correctif du 25 août 2026 pouvaient fabriquer un
identifiant de visite tronqué (`VIS-########`) puis perdre l'opération parent de
la file. Les créations de réserves et le RPC de rattachement restaient alors
bloqués sur une clé étrangère vers une visite absente.

La récupération s'exécute pendant l'hydratation de la file, avant tout appel
réseau. Elle ne s'active que lorsque les conditions suivantes sont toutes
réunies :

1. l'identifiant correspond au format historique tronqué ;
2. une opération encore rejouable porte déjà une preuve serveur de visite
   absente (`23503`, contrainte `reserves_tenant_visite_fkey` ou
   `Visite introuvable`) ;
3. aucune création de cette visite n'est encore présente dans la file ;
4. l'organisation active est connue et concorde avec les réserves ;
5. un seul chantier peut être déduit.

La visite complète est restaurée depuis le cache lorsqu'elle y existe encore.
Sinon un parent minimal, explicitement marqué comme récupéré dans son titre et
ses notes, est construit à partir des réserves durables. L'insertion parent est
persistée dans la file avec l'état `never_started`, puis exécutée avant les
réserves grâce à la priorité des visites.

L'insertion est « si absente » : si un autre appareil a déjà recréé la visite,
le client accepte uniquement une ligne portant le même identifiant, la même
organisation et le même chantier. Il n'écrase jamais une ligne existante. Toute
ambiguïté d'organisation ou de chantier bloque la réparation et conserve les
opérations originales pour diagnostic.

Une dépendance que les tentatives historiques auraient déjà classée comme
terminale est réactivée uniquement lorsqu'une visite de récupération sûre a été
planifiée. Ses anciennes échéances et classifications d'échec sont retirées ;
son message d'erreur reste disponible jusqu'au succès effectif de la reprise.
