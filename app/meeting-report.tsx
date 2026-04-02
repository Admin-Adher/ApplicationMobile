import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, Modal } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';
import { MeetingReport } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { genId, formatDateFR } from '@/lib/utils';

const CRR_TEMPLATES = [
  {
    id: 'hebdo',
    label: 'Réunion hebdomadaire',
    icon: 'calendar-outline' as const,
    subject: 'Réunion de chantier hebdomadaire',
    agenda: '1. Point avancement travaux\n2. Planning semaine suivante\n3. Levée des réserves\n4. Problèmes et blocages\n5. Questions diverses',
    agendaNote: 'Point avancement travaux réalisé.\nPlanning semaine suivante défini.\nÉtat des réserves en cours de traitement.',
  },
  {
    id: 'reception',
    label: 'OPR / Réception',
    icon: 'ribbon-outline' as const,
    subject: 'Opérations Préalables à la Réception (OPR)',
    agenda: '1. Visite contradictoire des ouvrages\n2. Levée des réserves précédentes\n3. Constatation des nouvelles réserves\n4. Signatures du PV',
    agendaNote: 'Visite contradictoire effectuée.\nListe des réserves établie.\nDélais de levée fixés contractuellement.',
  },
  {
    id: 'coordination',
    label: 'Coordination de chantier',
    icon: 'people-outline' as const,
    subject: 'Réunion de coordination interentreprises',
    agenda: '1. Point sécurité / PPSPS\n2. Coordination des interventions\n3. Gestion des interfaces\n4. Planning co-activités\n5. Divers',
    agendaNote: 'Point sécurité réalisé.\nCoordination des zones de travail validée.\nPlanning co-activités transmis.',
  },
  {
    id: 'synthese',
    label: 'Réunion de synthèse BET',
    icon: 'construct-outline' as const,
    subject: 'Réunion de synthèse bureaux d\'études',
    agenda: '1. Cohérence des plans d\'exécution\n2. Points de blocage techniques\n3. Commandes et approvisionnements\n4. Validation des fiches techniques\n5. Planning études',
    agendaNote: 'Points de blocage identifiés et traités.\nFiches techniques en attente de validation.',
  },
];

const MEETING_KEY = 'buildtrack_meetings_v1';

function buildMeetingHTML(report: MeetingReport, projectName: string): string {
  const exportDate = new Date().toLocaleDateString('fr-FR');
  const docRef = `CRR-${report.date.replace(/\//g, '')}-${report.id.slice(0, 6).toUpperCase()}`;
  const doneCount = report.actions.filter(a => a.status === 'done').length;
  const pendingCount = report.actions.length - doneCount;

  const decisionsHtml = report.decisions.length > 0
    ? report.decisions.map((d, i) =>
        `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #EEF3FA">
          <div style="min-width:22px;height:22px;background:#003082;border-radius:50%;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</div>
          <div style="font-size:12px;color:#1A2742;line-height:1.5">${d}</div>
        </div>`
      ).join('')
    : `<div style="font-size:12px;color:#6B7280;font-style:italic">Aucune décision formalisée lors de cette réunion.</div>`;

  const actionsHtml = report.actions.map(a =>
    `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${a.description}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:600">${a.responsible}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${a.deadline}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${a.status === 'done' ? '#ECFDF5' : '#FFFBEB'};color:${a.status === 'done' ? '#059669' : '#D97706'};font-size:10px;font-weight:700;padding:2px 10px;border-radius:10px">
          ${a.status === 'done' ? '✓ Fait' : '⏳ En attente'}
        </span>
      </td>
    </tr>`
  ).join('');

  const sH = (t: string) => `<div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:10px;margin-top:22px;padding-bottom:6px;border-bottom:1.5px solid #DDE4EE">${t}</div>`;

  const participantsList = report.participants.split('\n').filter(p => p.trim()).map(p =>
    `<span style="display:inline-block;background:#F4F7FB;border:1px solid #DDE4EE;border-radius:20px;padding:3px 10px;font-size:11px;margin:3px 4px 3px 0">${p.trim()}</span>`
  ).join('');

  const agendaItems = report.agenda.split('\n').filter(a => a.trim()).map((item, i) =>
    `<div style="display:flex;gap:10px;padding:6px 0;font-size:12px">
      <span style="color:#003082;font-weight:700;min-width:20px">${i + 1}.</span>
      <span>${item.replace(/^\d+\.\s*/, '')}</span>
    </div>`
  ).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1A2742; font-size: 12px; padding: 28px 32px; line-height: 1.5; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { margin: 15mm 12mm; } }
    </style>
  </head><body>

    <!-- Letterhead -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #003082;margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:42px;height:42px;background:#003082;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px">BT</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:#003082">BuildTrack</div>
          <div style="font-size:10px;color:#6B7280">Gestion de chantier numérique</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1A2742">Compte-rendu de réunion</div>
        <div style="font-size:12px;color:#6B7280;margin-top:3px">${report.subject}</div>
        <div style="font-size:10px;color:#6B7280;margin-top:8px">Projet : <strong style="color:#1A2742">${projectName}</strong></div>
        <div style="font-size:10px;color:#6B7280">Réf. : <strong style="color:#1A2742">${docRef}</strong></div>
      </div>
    </div>

    <!-- Info cards -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
      ${[
        { label: 'Date de réunion', value: report.date },
        { label: 'Lieu', value: report.location || 'Non précisé' },
        { label: 'Rédigé par', value: report.redactedBy },
        { label: 'Actions total', value: `${doneCount}/${report.actions.length} faites` },
      ].map(i => `
        <div style="flex:1;min-width:130px;background:#F4F7FB;border-radius:8px;padding:10px 14px;border:1px solid #DDE4EE">
          <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:4px;font-weight:700">${i.label}</div>
          <div style="font-size:13px;font-weight:700;color:#1A2742">${i.value}</div>
        </div>`).join('')}
    </div>

    ${pendingCount > 0 ? `
      <div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;color:#92400E">
        ⏳ <strong>${pendingCount} action${pendingCount > 1 ? 's' : ''} en attente</strong> depuis cette réunion
      </div>` : ''}

    ${sH('Ordre du jour')}
    <div style="background:#F4F7FB;border-radius:10px;padding:12px 16px;margin-bottom:4px">${agendaItems || '<div style="color:#6B7280;font-style:italic">Ordre du jour non précisé</div>'}</div>

    ${sH('Participants')}
    <div style="padding:10px 0">${participantsList || '<span style="color:#6B7280;font-style:italic">Non précisé</span>'}</div>

    ${sH('Compte-rendu des discussions')}
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 16px;border:1px solid #DDE4EE;font-size:12px;line-height:1.7;white-space:pre-wrap">${report.notes || 'Aucun compte-rendu saisi.'}</div>

    ${sH('Décisions prises')}
    ${decisionsHtml}

    ${report.actions.length > 0 ? `
      ${sH(`Plan d'actions (${report.actions.length})`)}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Action</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Responsable</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Échéance</th>
          <th style="background:#003082;color:#fff;padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Statut</th>
        </tr></thead>
        <tbody>${actionsHtml}</tbody>
      </table>` : ''}

    <div style="display:flex;gap:24px;margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;font-weight:700">Prochaine réunion</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${report.nextMeeting || 'À définir'}</div>
      </div>
      <div style="flex:1;border:1.5px solid #DDE4EE;border-radius:10px;padding:14px 18px;background:#FAFBFF">
        <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:30px;font-weight:700">Signature du rédacteur</div>
        <div style="border-bottom:2px solid #1A2742;margin-bottom:6px"></div>
        <div style="font-size:12px;font-weight:700;color:#1A2742">${report.redactedBy}</div>
      </div>
    </div>

    <div style="margin-top:28px;padding-top:12px;border-top:1.5px solid #DDE4EE;display:flex;justify-content:space-between;font-size:9px;color:#6B7280">
      <span>Généré par BuildTrack — ${projectName}</span>
      <span>Document confidentiel — Exporté le ${exportDate}</span>
    </div>
  </body></html>`;
}

export default function MeetingReportScreen() {
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { reserves, companies, activeChantierId } = useApp();
  const [reports, setReports] = useState<MeetingReport[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(MEETING_KEY).then(raw => {
      if (raw) { try { setReports(JSON.parse(raw)); } catch {} }
    });
  }, []);
  const [showNew, setShowNew] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(formatDateFR(new Date()));
  const [location, setLocation] = useState('');
  const [participants, setParticipants] = useState('');
  const [agenda, setAgenda] = useState('');
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState('');
  const [nextMeeting, setNextMeeting] = useState('');

  const resetForm = () => {
    setSubject(''); setDate(formatDateFR(new Date())); setLocation('');
    setParticipants(''); setAgenda(''); setNotes(''); setDecisions(''); setNextMeeting('');
  };

  function applyTemplate(tpl: typeof CRR_TEMPLATES[0]) {
    const openReserves = reserves.filter(r => r.status !== 'closed' && (!activeChantierId || r.chantierId === activeChantierId));
    const companyNames = companies.map(c => c.name).join(', ');
    setSubject(tpl.subject + ' — ' + projectName);
    setAgenda(tpl.agenda);
    setNotes(tpl.agendaNote);
    if (tpl.id === 'hebdo') {
      setDecisions([
        `${openReserves.length} réserve${openReserves.length !== 1 ? 's' : ''} en cours de traitement`,
        'Planning semaine suivante validé',
      ].join('\n'));
    }
    if (companyNames) setParticipants(companyNames + (user?.name ? '\n' + user.name : ''));
    setShowTemplateModal(false);
    setShowNew(true);
  }

  const handleCreate = useCallback(() => {
    if (!subject.trim()) {
      Alert.alert('Champ requis', "L'objet de la réunion est obligatoire.");
      return;
    }
    const report: MeetingReport = {
      id: genId(),
      subject: subject.trim(),
      date,
      location: location.trim() || 'Non précisé',
      participants: participants.trim() || 'Non précisé',
      agenda: agenda.trim(),
      notes: notes.trim(),
      decisions: decisions.split('\n').map(s => s.trim()).filter(Boolean),
      actions: [],
      nextMeeting: nextMeeting.trim(),
      redactedBy: user?.name ?? 'Équipe',
      createdAt: formatDateFR(new Date()),
    };
    setReports(prev => {
      const updated = [report, ...prev];
      AsyncStorage.setItem(MEETING_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    resetForm();
    setShowNew(false);
  }, [subject, date, location, participants, agenda, notes, decisions, nextMeeting, user]);

  async function handleExportPDF(report: MeetingReport) {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter.");
      return;
    }
    const html = buildMeetingHTML(report, projectName);
    if (Platform.OS === 'web') {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open(); doc.write(html); doc.close();
        setTimeout(() => {
          try { iframe.contentWindow?.print(); } catch {}
          setTimeout(() => document.body.removeChild(iframe), 5000);
        }, 300);
      }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Partager le CR' });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title="CR de réunion"
        subtitle="Comptes-rendus chantier"
        showBack
        rightLabel={permissions.canCreate ? (showNew ? 'Annuler' : 'Nouveau') : undefined}
        onRightPress={permissions.canCreate ? () => { if (showNew) { setShowNew(false); resetForm(); } else setShowNew(true); } : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {!showNew && permissions.canCreate && (
          <TouchableOpacity style={styles.templateBanner} onPress={() => setShowTemplateModal(true)}>
            <Ionicons name="flash" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.templateBannerTitle}>Générer depuis un modèle CRR</Text>
              <Text style={styles.templateBannerSub}>Pré-remplissez automatiquement l'ordre du jour selon le type de réunion</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}

        {showNew && (
          <View style={styles.card}>
            <View style={styles.formTopRow}>
              <Text style={styles.sectionTitle}>Nouveau compte-rendu</Text>
              <TouchableOpacity style={styles.tplBtn} onPress={() => setShowTemplateModal(true)}>
                <Ionicons name="flash-outline" size={13} color={C.primary} />
                <Text style={styles.tplBtnText}>Modèle</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Objet *</Text>
            <TextInput style={styles.input} placeholder="Ex: Réunion de chantier hebdomadaire" placeholderTextColor={C.textMuted} value={subject} onChangeText={setSubject} />
            <Text style={styles.label}>Date</Text>
            <TextInput style={styles.input} placeholder="JJ/MM/AAAA" placeholderTextColor={C.textMuted} value={date} onChangeText={setDate} />
            <Text style={styles.label}>Lieu</Text>
            <TextInput style={styles.input} placeholder="Ex: Salle de réunion, Bâtiment A" placeholderTextColor={C.textMuted} value={location} onChangeText={setLocation} />
            <Text style={styles.label}>Participants</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Noms et entreprises des participants..." placeholderTextColor={C.textMuted} value={participants} onChangeText={setParticipants} multiline numberOfLines={3} />
            <Text style={styles.label}>Ordre du jour</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Points à traiter..." placeholderTextColor={C.textMuted} value={agenda} onChangeText={setAgenda} multiline numberOfLines={3} />
            <Text style={styles.label}>Notes / Points discutés</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Résumé des échanges, problèmes soulevés..." placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
            <Text style={styles.label}>Décisions prises (une par ligne)</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Décision 1&#10;Décision 2..." placeholderTextColor={C.textMuted} value={decisions} onChangeText={setDecisions} multiline numberOfLines={3} />
            <Text style={styles.label}>Prochaine réunion</Text>
            <TextInput style={styles.input} placeholder="Ex: Lundi 06/04/2026 à 9h" placeholderTextColor={C.textMuted} value={nextMeeting} onChangeText={setNextMeeting} />
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={styles.createBtnText}>Créer le compte-rendu</Text>
            </TouchableOpacity>
          </View>
        )}

        {reports.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>Aucun compte-rendu</Text>
            <Text style={styles.emptyText}>Créez votre premier compte-rendu de réunion chantier.</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>Nouveau CR</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {reports.map(report => (
          <View key={report.id} style={styles.card}>
            <View style={styles.reportHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{report.subject}</Text>
                <Text style={styles.reportMeta}>{report.date} — {report.location}</Text>
                <Text style={styles.reportMeta}>Rédigé par {report.redactedBy}</Text>
              </View>
              {permissions.canExport && (
                <TouchableOpacity style={styles.pdfBtn} onPress={() => handleExportPDF(report)}>
                  <Ionicons name="download-outline" size={14} color={C.primary} />
                  <Text style={styles.pdfBtnText}>PDF</Text>
                </TouchableOpacity>
              )}
            </View>
            {report.decisions.length > 0 && (
              <View style={styles.decisionsBox}>
                <Text style={styles.decisionsTitle}>Décisions ({report.decisions.length})</Text>
                {report.decisions.map((d, i) => (
                  <View key={i} style={styles.decisionRow}>
                    <Ionicons name="checkmark-circle" size={14} color={C.closed} />
                    <Text style={styles.decisionText}>{d}</Text>
                  </View>
                ))}
              </View>
            )}
            {report.notes ? (
              <Text style={styles.notesText} numberOfLines={3}>{report.notes}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={showTemplateModal} transparent animationType="slide" onRequestClose={() => setShowTemplateModal(false)}>
        <View style={styles.tplOverlay}>
          <View style={styles.tplSheet}>
            <View style={styles.tplHandle} />
            <Text style={styles.tplSheetTitle}>Choisir un modèle CRR</Text>
            <Text style={styles.tplSheetSub}>Le formulaire sera pré-rempli selon le type de réunion</Text>
            {CRR_TEMPLATES.map(tpl => (
              <TouchableOpacity key={tpl.id} style={styles.tplRow} onPress={() => applyTemplate(tpl)}>
                <View style={styles.tplRowIcon}>
                  <Ionicons name={tpl.icon} size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplRowLabel}>{tpl.label}</Text>
                  <Text style={styles.tplRowSub} numberOfLines={2}>{tpl.agenda.split('\n')[0]}{tpl.agenda.split('\n').length > 1 ? '…' : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.tplCancelBtn} onPress={() => setShowTemplateModal(false)}>
              <Text style={styles.tplCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: C.primary + '40' },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  reportTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  reportMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  pdfBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  decisionsBox: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 10 },
  decisionsTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 8 },
  decisionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  decisionText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  notesText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, fontStyle: 'italic', lineHeight: 18 },

  templateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 16,
  },
  templateBannerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateBannerSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  formTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  tplBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  tplBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  tplOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  tplSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
  },
  tplHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  tplSheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 },
  tplSheetSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 18 },
  tplRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tplRowIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  tplRowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  tplRowSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  tplCancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 12 },
  tplCancelText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.textSub },
});
