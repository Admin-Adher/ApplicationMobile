import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  View,
  PanResponder,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Text,
  useWindowDimensions,
} from 'react-native';
import { C } from '@/constants/colors';

export interface SignaturePadRef {
  getSVGData: () => string | null;
  isEmpty: () => boolean;
  clear: () => void;
}

interface Point {
  x: number;
  y: number;
}

const PAD_MAX_WIDTH = 320;
const PAD_HEIGHT = 140;
const STROKE_COLOR = '#1A2742';
const STROKE_WIDTH = 2.5;

function buildSVGString(strokes: Point[][], padWidth: number): string {
  const pathDefs = strokes
    .filter(s => s.length > 0)
    .map(stroke => {
      if (stroke.length === 1) {
        const p = stroke[0];
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.5" fill="${STROKE_COLOR}"/>`;
      }
      const d = stroke
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      return `<path d="${d}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${padWidth}" height="${PAD_HEIGHT}" style="background:white">${pathDefs}</svg>`;
}

const SignaturePad = forwardRef<SignaturePadRef>((_, ref) => {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const currentStrokeRef = useRef<Point[]>([]);
  const isDrawingRef = useRef(false);
  const canvasRef = useRef<any>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const PAD_WIDTH = Math.min(PAD_MAX_WIDTH, screenWidth - 48);

  const initCanvas = useCallback((el: any) => {
    if (!el) return;
    canvasRef.current = el;
    const canvas = el as HTMLCanvasElement;
    canvas.width = PAD_WIDTH * 2;
    canvas.height = PAD_HEIGHT * 2;
    canvas.style.width = PAD_WIDTH + 'px';
    canvas.style.height = PAD_HEIGHT + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(2, 2);
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctxRef.current = ctx;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    getSVGData: () => {
      if (strokes.length === 0 || strokes.every(s => s.length === 0)) return null;
      return buildSVGString(strokes, PAD_WIDTH);
    },
    isEmpty: () => strokes.length === 0 || strokes.every(s => s.length === 0),
    clear: () => {
      setStrokes([]);
      currentStrokeRef.current = [];
      if (Platform.OS === 'web' && ctxRef.current && canvasRef.current) {
        const canvas = canvasRef.current as HTMLCanvasElement;
        ctxRef.current.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
  }));

  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrapper}>
        <canvas
          ref={initCanvas}
          style={{
            width: PAD_WIDTH,
            height: PAD_HEIGHT,
            maxWidth: '100%',
            border: '1.5px solid #DDE4EE',
            borderRadius: 10,
            backgroundColor: '#fff',
            touchAction: 'none',
            cursor: 'crosshair',
            display: 'block',
          } as any}
          onPointerDown={(e: any) => {
            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            isDrawingRef.current = true;
            currentStrokeRef.current = [{ x, y }];
            setStrokes(prev => [...prev, [{ x, y }]]);
            if (ctxRef.current) {
              ctxRef.current.beginPath();
              ctxRef.current.moveTo(x, y);
            }
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e: any) => {
            if (!isDrawingRef.current) return;
            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            currentStrokeRef.current.push({ x, y });
            if (ctxRef.current) {
              ctxRef.current.lineTo(x, y);
              ctxRef.current.stroke();
              ctxRef.current.beginPath();
              ctxRef.current.moveTo(x, y);
            }
          }}
          onPointerUp={() => {
            if (!isDrawingRef.current) return;
            isDrawingRef.current = false;
            const finished = [...currentStrokeRef.current];
            currentStrokeRef.current = [];
            setStrokes(prev => {
              const without = prev.slice(0, -1);
              return [...without, finished];
            });
          }}
          onPointerLeave={() => {
            if (!isDrawingRef.current) return;
            isDrawingRef.current = false;
            const finished = [...currentStrokeRef.current];
            currentStrokeRef.current = [];
            setStrokes(prev => {
              const without = prev.slice(0, -1);
              return [...without, finished];
            });
          }}
        />
      </View>
    );
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        const { locationX, locationY } = evt.nativeEvent;
        isDrawingRef.current = true;
        const start = [{ x: locationX, y: locationY }];
        currentStrokeRef.current = start;
        setStrokes(prev => [...prev, start]);
      },
      onPanResponderMove: evt => {
        if (!isDrawingRef.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        const pt = { x: locationX, y: locationY };
        currentStrokeRef.current = [...currentStrokeRef.current, pt];
        setStrokes(prev => [...prev.slice(0, -1), currentStrokeRef.current]);
      },
      onPanResponderRelease: () => {
        isDrawingRef.current = false;
        const finished = [...currentStrokeRef.current];
        currentStrokeRef.current = [];
        setStrokes(prev => [...prev.slice(0, -1), finished]);
      },
    })
  ).current;

  const dots: { x: number; y: number; key: string }[] = [];
  strokes.forEach((stroke, si) => {
    stroke.forEach((pt, pi) => {
      dots.push({ x: pt.x, y: pt.y, key: `${si}-${pi}` });
    });
  });

  return (
    <View style={styles.wrapper}>
      <View style={[styles.pad, { width: PAD_WIDTH }]} {...panResponder.panHandlers}>
        {dots.map(dot => (
          <View
            key={dot.key}
            style={[styles.dot, { left: dot.x - 1.5, top: dot.y - 1.5 }]}
          />
        ))}
        {strokes.length === 0 && (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Signez ici</Text>
          </View>
        )}
      </View>
    </View>
  );
});

SignaturePad.displayName = 'SignaturePad';

export default SignaturePad;

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginVertical: 4,
  },
  pad: {
    height: PAD_HEIGHT,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    overflow: 'hidden',
    position: 'relative',
  },
  dot: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: STROKE_COLOR,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
});
