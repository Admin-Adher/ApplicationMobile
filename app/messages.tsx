import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Message } from '@/constants/types';
import Header from '@/components/Header';

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === 'notification' || msg.type === 'system') {
    return (
      <View style={styles.notifWrap}>
        <View style={styles.notifBubble}>
          <Ionicons name="notifications" size={12} color={C.inProgress} />
          <Text style={styles.notifText}>{msg.content}</Text>
        </View>
        <Text style={styles.notifTime}>{msg.timestamp}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrap, msg.isMe && styles.bubbleWrapMe]}>
      {!msg.isMe && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{msg.sender.charAt(0)}</Text>
        </View>
      )}
      <View style={{ maxWidth: '75%' }}>
        {!msg.isMe && <Text style={styles.sender}>{msg.sender}</Text>}
        <View style={[styles.bubble, msg.isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.msgText, msg.isMe && styles.msgTextMe]}>{msg.content}</Text>
        </View>
        <Text style={[styles.time, msg.isMe && styles.timeMe]}>{msg.timestamp}</Text>
      </View>
    </View>
  );
}

export default function MessagesScreen() {
  const { messages, addMessage, markMessagesRead } = useApp();
  const { user } = useAuth();
  const [text, setText] = useState('');

  useEffect(() => {
    markMessagesRead();
  }, []);

  function handleSend() {
    if (!text.trim()) return;
    addMessage(text.trim(), user?.name ?? 'Moi');
    setText('');
  }

  return (
    <View style={styles.container}>
      <Header title="Messages" subtitle={`${messages.length} messages`} showBack />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={[...messages].reverse()}
          keyExtractor={item => item.id}
          inverted
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <MessageBubble msg={item} />}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Écrire un message..."
            placeholderTextColor={C.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <Ionicons name="send" size={18} color={text.trim() ? '#fff' : C.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  list: { padding: 16, paddingBottom: 8, flexDirection: 'column-reverse' },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  bubbleWrapMe: { justifyContent: 'flex-end' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  sender: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 4, marginLeft: 4 },
  bubble: { borderRadius: 16, padding: 12 },
  bubbleThem: { backgroundColor: C.surface2, borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 20 },
  msgTextMe: { color: '#fff' },
  time: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4, marginLeft: 4 },
  timeMe: { textAlign: 'right', marginRight: 4 },
  notifWrap: { alignItems: 'center', marginBottom: 14 },
  notifBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgressBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  notifText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress, maxWidth: 260 },
  notifTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.bg,
    paddingBottom: Platform.OS === 'web' ? 34 : 12,
  },
  input: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border, maxHeight: 100,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.surface2 },
});
