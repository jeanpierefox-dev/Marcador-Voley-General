
import React, { useEffect, useRef, useState } from 'react';
import { Peer } from 'peerjs';
import { LiveMatchState, Team, Tournament, User } from '../types';
import { ScoreControl } from './ScoreControl';
import { RotationView } from './RotationView';

interface TVOverlayProps {
  match: LiveMatchState;
  onUpdateMatch?: (updates: Partial<LiveMatchState>) => void;
  teamA: Team;
  teamB: Team;
  swapSides?: boolean;
  tournament?: Tournament | null;
  currentUser?: User | null;
  onExit: () => void;
  onLogout?: () => void;
  onBack?: () => void; // New prop for Viewers to go back to Dashboard
  onNextSet?: () => void;
  nextSetCountdown?: number | null;
  showStatsOverlay?: boolean;
  showScoreboard?: boolean;
  isCloudConnected?: boolean;
  // Control Handlers
  onPoint?: (teamId: string, type: 'attack' | 'block' | 'ace' | 'opponent_error' | 'yellow_card' | 'red_card', playerId?: string) => void;
  onSubtractPoint?: (teamId: string) => void;
  onRequestTimeout?: (teamId: string) => void;
  onRequestSub?: (teamId: string) => void;
  onModifyRotation?: (teamId: string) => void;
  onSetServe?: (teamId: string) => void;
}

const TVOverlay: React.FC<TVOverlayProps> = ({ 
  match, 
  teamA, 
  teamB, 
  swapSides = false,
  tournament,
  currentUser,
  onExit, 
  onNextSet,
  nextSetCountdown,
  showStatsOverlay = false,
  showScoreboard = true,
  isCloudConnected = true,
  onUpdateMatch,
  onPoint,
  onSubtractPoint,
  onRequestTimeout,
  onRequestSub,
  onModifyRotation,
  onSetServe
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isViewer = currentUser?.role === 'VIEWER';
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role?.includes('COACH');

  // PeerJS State
  const isBroadcasting = true; // Hardcoded to true now since toggle was removed
  const [viewerStream, setViewerStream] = useState<MediaStream | null>(null);
  
  // Controls State
  const [showControls, setShowControls] = useState(false);

  // Transition States
  const [stingerAnim, setStingerAnim] = useState<'idle' | 'in' | 'out'>('idle');
  const [boardAnim, setBoardAnim] = useState<'idle' | 'in' | 'out'>('idle');
  const [renderScoreboard, setRenderScoreboard] = useState(showScoreboard);
  const [isConstructing, setIsConstructing] = useState(false);

  // New features state
  const [pointBanner, setPointBanner] = useState<{ text: string, color: string } | null>(null);

  // Set Point / Match Point Logic
  const prevScore = useRef({ a: match.scoreA, b: match.scoreB });
  useEffect(() => {
      // Calculate current wins based ONLY on finished sets
      let calcWinsA = 0; let calcWinsB = 0;
      match.sets.forEach((s, idx) => {
          const isFinished = idx < match.currentSet - 1 || match.status === 'finished' || (match.status === 'finished_set' && idx === match.currentSet - 1);
          if (isFinished) {
              if (s.scoreA > s.scoreB) calcWinsA++;
              else if (s.scoreB > s.scoreA) calcWinsB++;
          }
      });
      const requiredWins = Math.ceil((match.config.maxSets || 3) / 2);
      const isTieBreak = match.currentSet === (match.config.maxSets || 3);
      const targetScore = isTieBreak ? (match.config.tieBreakPoints || 15) : (match.config.pointsPerSet || 25);

      const checkPoint = (currentScoreA: number, currentScoreB: number, prevA: number, prevB: number) => {
          let teamAPoint = (currentScoreA >= targetScore - 1) && (currentScoreA - currentScoreB >= 1);
          let teamBPoint = (currentScoreB >= targetScore - 1) && (currentScoreB - currentScoreA >= 1);

          // Only trigger if it just became point
          let wasTeamAPoint = (prevA >= targetScore - 1) && (prevA - prevB >= 1);
          let wasTeamBPoint = (prevB >= targetScore - 1) && (prevB - prevA >= 1);

          if (teamAPoint && !wasTeamAPoint) {
             const isMatchPoint = calcWinsA === requiredWins - 1;
             setPointBanner({ text: isMatchPoint ? 'MATCH POINT' : 'SET POINT', color: '#827DFF' });
             setTimeout(() => setPointBanner(null), 3000);
          } else if (teamBPoint && !wasTeamBPoint) {
             const isMatchPoint = calcWinsB === requiredWins - 1;
             setPointBanner({ text: isMatchPoint ? 'MATCH POINT' : 'SET POINT', color: '#4C8BFF' });
             setTimeout(() => setPointBanner(null), 3000);
          }
      };

      checkPoint(match.scoreA, match.scoreB, prevScore.current.a, prevScore.current.b);
      prevScore.current = { a: match.scoreA, b: match.scoreB };
  }, [match.scoreA, match.scoreB, match.currentSet, match.sets, match.config]);
  // const [showRotationView, setShowRotationView] = useState(false); // Removed, now using activeShowRotation

  // Camera Selection State
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const chromaMode = 'green' as string; // Replaced local state with fallback default
  const [showUI, setShowUI] = useState(true);

  // PeerJS Logic (Admin - Broadcaster)
  useEffect(() => {
      if (!isAdmin || !isBroadcasting || !videoRef.current || !videoRef.current.srcObject) return;

      const stream = videoRef.current.srcObject as MediaStream;
      const peer = new Peer();

      peer.on('open', (id) => {
          console.log('My peer ID is: ' + id);
          if (onUpdateMatch) {
              onUpdateMatch({ adminPeerId: id });
          }
      });

      peer.on('call', (call) => {
          call.answer(stream); // Answer the call with an A/V stream.
      });

      return () => {
          peer.destroy();
          if (onUpdateMatch) {
             // onUpdateMatch({ adminPeerId: undefined }); // Optional: clear ID on stop
          }
      };
  }, [isAdmin, isBroadcasting, selectedDeviceId]); // Re-run if camera changes

  // PeerJS Logic (Viewer - Receiver)
  useEffect(() => {
      if (!isViewer || !match.adminPeerId || viewerStream) return;

      const peer = new Peer();

      peer.on('open', () => {
          // const conn = peer.connect(match.adminPeerId!); // Not needed for stream only
          const call = peer.call(match.adminPeerId!, new MediaStream()); // Call to get stream

          call.on('stream', (remoteStream) => {
              setViewerStream(remoteStream);
              if (videoRef.current) {
                  videoRef.current.srcObject = remoteStream;
                  videoRef.current.play().catch(e => console.error("Error playing remote stream", e));
              }
          });
      });

      return () => {
          peer.destroy();
      };
  }, [isViewer, match.adminPeerId]);

  // Determine if it's "Pre-Match" based on status
  const isPreMatch = match.status === 'warmup';
  
  // Determine if set is finished
  const isSetFinished = match.status === 'finished_set';

  // Broadcast Settings
  const isVertical = match.tvSettings?.style === 'vertical';

  // Unified Transitions ("Stinger Effect")
  const [visibleState, setVisibleState] = useState({
      showScoreboard,
      showStatsOverlay,
      showRotation: match.showRotation,
      tvSettings: match.tvSettings
  });

  const isTransitioningRef = useRef(false);
  const activePropsRef = useRef({
      showScoreboard,
      showStatsOverlay,
      showRotation: match.showRotation,
      tvSettings: match.tvSettings
  });

  useEffect(() => {
      // Check if any visual setting has changed vs our targeted active props
      const hasChanged = 
          showScoreboard !== activePropsRef.current.showScoreboard ||
          showStatsOverlay !== activePropsRef.current.showStatsOverlay ||
          match.showRotation !== activePropsRef.current.showRotation ||
          JSON.stringify(match.tvSettings) !== JSON.stringify(activePropsRef.current.tvSettings);

      if (hasChanged && !isTransitioningRef.current) {
          isTransitioningRef.current = true;
          
          const oldProps = activePropsRef.current;
          const oldSettings = oldProps.tvSettings;
          const newSettings = match.tvSettings;

          // Determine if we are changing major overlays
          const majorSettingsChanged = 
              oldProps.showStatsOverlay !== showStatsOverlay ||
              oldProps.showRotation !== match.showRotation ||
              oldSettings?.showVersus !== newSettings?.showVersus ||
              oldSettings?.featuredPlayerMode !== newSettings?.featuredPlayerMode ||
              oldSettings?.showFormations !== newSettings?.showFormations ||
              oldSettings?.showSetStatsExt !== newSettings?.showSetStatsExt ||
              oldSettings?.showMatchStatsExt !== newSettings?.showMatchStatsExt ||
              oldSettings?.showTopPlayersExt !== newSettings?.showTopPlayersExt;

          activePropsRef.current = {
             showScoreboard, showStatsOverlay, showRotation: match.showRotation, tvSettings: match.tvSettings
          };

          const performStateUpdate = () => {
              setVisibleState({
                  showScoreboard,
                  showStatsOverlay,
                  showRotation: match.showRotation,
                  tvSettings: match.tvSettings
              });
              setRenderScoreboard(showScoreboard);
              
              if (showStatsOverlay && !visibleState.showStatsOverlay) {
                  setIsConstructing(true);
                  setTimeout(() => setIsConstructing(false), 500);
              }

              if (showScoreboard && !visibleState.showScoreboard) {
                  setBoardAnim('in');
                  setTimeout(() => setBoardAnim('idle'), 800);
              } else if (!showScoreboard && visibleState.showScoreboard) {
                  setBoardAnim('out');
                  setTimeout(() => setBoardAnim('idle'), 800);
              }
          };

          const runStinger = (callback: () => void) => {
              setStingerAnim('in');
              setTimeout(() => {
                  callback();
                  setStingerAnim('out');
                  setTimeout(() => {
                      setStingerAnim('idle');
                      isTransitioningRef.current = false;
                  }, 500);
              }, 500);
          };

          if (!majorSettingsChanged) {
              // No stinger for minor features
              performStateUpdate();
              isTransitioningRef.current = false;
          } else {
              // Both hiding and showing major overlays should trigger stinger first
              runStinger(() => {
                  performStateUpdate();
              });
          }
      }
  }, [showScoreboard, showStatsOverlay, match.showRotation, match.tvSettings, visibleState]);

  // Use visibleState properties instead of the direct props for UI rendering
  const activeShowStatsOverlay = visibleState.showStatsOverlay;
  const activeShowRotation = visibleState.showRotation;
  const activeTvSettings = visibleState.tvSettings;

  // ... (rest of the code)

  // Enumerate Devices on Mount (Admin Only)
  useEffect(() => {
      if (isViewer) return;
      
      // Check support
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          console.warn("Media Devices API not supported");
          return;
      }

      const getDevices = async () => {
          try {
              // Request permission first to get labels, handle rejection gracefully
              try {
                  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                  // Stop the stream immediately, we just needed permission
                  stream.getTracks().forEach(track => track.stop());
              } catch (e) {
                  console.warn("Permission check failed, proceeding without labels if possible");
              }
              
              const devices = await navigator.mediaDevices.enumerateDevices();
              const videoInputs = devices.filter(d => d.kind === 'videoinput');
              setVideoDevices(videoInputs);
              if (videoInputs.length > 0 && !selectedDeviceId) {
                  // Prefer back camera if available, otherwise first
                  const backCam = videoInputs.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                  setSelectedDeviceId(backCam ? backCam.deviceId : videoInputs[0].deviceId);
              }
          } catch (e) {
              console.warn("Error enumerating devices", e);
          }
      };
      getDevices();
  }, [isViewer]);

  // Handle Remote Camera Switch
  useEffect(() => {
     if (activeTvSettings?.forceCameraChangeTrigger) {
         if (videoDevices.length > 1) {
             const currentIndex = videoDevices.findIndex(d => d.deviceId === selectedDeviceId);
             const nextIndex = (currentIndex + 1) % videoDevices.length;
             setSelectedDeviceId(videoDevices[nextIndex].deviceId);
         }
     }
  }, [activeTvSettings?.forceCameraChangeTrigger]);

  // Activate Camera Logic
  useEffect(() => {
    if (isViewer) return; // Skip camera for viewers
    if (chromaMode !== 'none') {
       // Stop any existing stream
       if (videoRef.current && videoRef.current.srcObject) {
         try {
            const oldStream = videoRef.current.srcObject as MediaStream;
            oldStream.getTracks().forEach(track => track.stop());
         } catch(e) { }
         videoRef.current.srcObject = null;
       }
       setCameraError(null);
       return;
    }

    let activeStream: MediaStream | null = null;
    let isMounted = true;

    async function setupCamera() {
      // Reset error state
      setCameraError(null);

      // FORCE STOP previous stream if exists in ref
      if (videoRef.current && videoRef.current.srcObject) {
         try {
            const oldStream = videoRef.current.srcObject as MediaStream;
            oldStream.getTracks().forEach(track => track.stop());
         } catch(e) { /* ignore */ }
         if (videoRef.current) videoRef.current.srcObject = null;
      }

      // Check if API exists
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          if (isMounted) setCameraError("Navegador no soporta cámara o contexto inseguro (HTTPS requerido).");
          return;
      }

      try {
        const constraints: MediaStreamConstraints = {
            video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'environment' }
        };

        // Try high res if possible
        if (!selectedDeviceId) {
             // @ts-ignore
             constraints.video.width = { ideal: 1920 };
             // @ts-ignore
             constraints.video.height = { ideal: 1080 };
        }

        console.log("Requesting camera with constraints:", constraints);
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (isMounted) {
            activeStream = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = activeStream;
                await videoRef.current.play().catch(e => console.warn("Autoplay blocked", e));
            }
        } else {
            stream.getTracks().forEach(track => track.stop());
        }

      } catch (err) {
        console.warn("High-spec camera failed, trying fallback...", err);
        
        try {
            if (!isMounted) return;
            // Stop any previous stream if it exists (though it shouldn't if we are in catch)
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
                activeStream = null;
            }
            
            // Wait a bit before retrying to let the hardware release
            await new Promise(resolve => setTimeout(resolve, 500));

            // Fallback 1: Standard VGA
            const fallbackConstraints = { 
                video: { width: 640, height: 480, facingMode: 'environment' } 
            };
            console.log("Trying fallback 1:", fallbackConstraints);
            
            const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            
            if (isMounted) {
                activeStream = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = activeStream;
                    await videoRef.current.play().catch(e => console.warn("Autoplay blocked", e));
                }
            } else {
                stream.getTracks().forEach(track => track.stop());
            }
        } catch (err2: any) {
            console.warn("Fallback 1 failed, trying ultimate fallback...", err2);
            
            try {
                if (!isMounted) return;
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Fallback 2: Any video source
                const ultimateFallback = { video: true };
                console.log("Trying ultimate fallback:", ultimateFallback);
                
                const stream = await navigator.mediaDevices.getUserMedia(ultimateFallback);
                
                if (isMounted) {
                    activeStream = stream;
                    if (videoRef.current) {
                        videoRef.current.srcObject = activeStream;
                        await videoRef.current.play().catch(e => console.warn("Autoplay blocked", e));
                    }
                } else {
                    stream.getTracks().forEach(track => track.stop());
                }
            } catch (err3: any) {
                console.error("Critical Camera Error:", err3);
                if (isMounted) {
                    let msg = "No se pudo iniciar la cámara. " + (err3.message || err3.name);
                    if (err3.name === 'NotAllowedError' || err3.name === 'PermissionDeniedError') {
                        msg = "Permiso de cámara denegado. Por favor, habilítalo en la configuración del navegador.";
                    } else if (err3.name === 'NotFoundError' || err3.name === 'DevicesNotFoundError') {
                        msg = "No se encontró ninguna cámara.";
                    } else if (err3.name === 'NotReadableError' || err3.name === 'TrackStartError') {
                        msg = "La cámara está en uso por otra aplicación o no se puede acceder.";
                    }
                    setCameraError(msg);
                }
            }
        }
      }
    }
    
    setupCamera();
    
    return () => {
       isMounted = false;
       if (activeStream) {
         try {
            activeStream.getTracks().forEach(track => track.stop());
         } catch (e) { /* ignore */ }
       }
    };
  }, [isViewer, selectedDeviceId, chromaMode]);

  // Determine match state
  const sets = match.sets || [];
  const requiredWins = Math.ceil(match.config.maxSets / 2);
  
  let winsA = 0; let winsB = 0;
  sets.forEach((s, idx) => {
      const isFinished = idx < match.currentSet - 1 || match.status === 'finished' || (match.status === 'finished_set' && idx === match.currentSet - 1);
      if (isFinished) {
          if (s.scoreA > s.scoreB) winsA++;
          else if (s.scoreB > s.scoreA) winsB++;
      }
  });

  const matchEnded = winsA === requiredWins || winsB === requiredWins;
  const winner = winsA === requiredWins ? teamA : (winsB === requiredWins ? teamB : null);

  // Stats Logic
  const calculateTeamTotal = (teamId: string, type: 'attack' | 'block' | 'ace') => {
      let total = 0;
      // If specific set is selected, only count that set
      const setsToCount = (match.statsSetIndex !== undefined && match.sets[match.statsSetIndex]) 
          ? [match.sets[match.statsSetIndex]] 
          : sets;

      setsToCount.forEach(set => {
          total += (set.history || []).filter(h => h.teamId === teamId && h.type === type).length;
      });
      return total;
  };
  const calculateTeamErrors = (teamId: string) => {
      let total = 0;
      const setsToCount = (match.statsSetIndex !== undefined && match.sets[match.statsSetIndex]) 
          ? [match.sets[match.statsSetIndex]] 
          : sets;

      setsToCount.forEach(set => {
           total += (set.history || []).filter(h => h.teamId !== teamId && h.type === 'opponent_error').length;
      });
      return total;
  };

  const statsA = {
      attacks: calculateTeamTotal(teamA.id, 'attack'),
      blocks: calculateTeamTotal(teamA.id, 'block'),
      aces: calculateTeamTotal(teamA.id, 'ace'),
      errors: calculateTeamErrors(teamA.id)
  };

  const statsB = {
      attacks: calculateTeamTotal(teamB.id, 'attack'),
      blocks: calculateTeamTotal(teamB.id, 'block'),
      aces: calculateTeamTotal(teamB.id, 'ace'),
      errors: calculateTeamErrors(teamB.id)
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end pb-0 font-sans bg-transparent overflow-hidden transition-all duration-300">
      
      {/* Background (Chroma Key, Solid Color, or Camera) */}
      {chromaMode !== 'none' ? (
        <div 
          className="absolute inset-0 w-full h-full pointer-events-none" 
          style={{ 
            zIndex: -1, 
            backgroundColor: chromaMode === 'green' ? '#00FF00' : chromaMode === 'magenta' ? '#FF00FF' : '#0d1b2a' 
          }} 
        />
      ) : (!isViewer && !cameraError) || (isViewer && viewerStream) ? (
        <>
            <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted={!isViewer}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: -1 }} 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" style={{ zIndex: 0 }}></div>
        </>
      ) : (
        <div className={`absolute inset-0 w-full h-full ${isViewer ? 'bg-transparent' : 'bg-corp-bg'}`} style={{ zIndex: -1 }}>
            {/* Viewer Mode: Transparent background for OBS/Overlay usage */}
            {isViewer && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {/* Optional Placeholder */}
                </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" style={{ zIndex: 0 }}></div>
        </div>
      )}

      {/* --- STINGER TRANSITION OVERLAY --- */}
      {stingerAnim !== 'idle' && (
      <div key={stingerAnim} className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none rounded-[100%] md:rounded-none ${isVertical ? 'rotate-90' : ''}`}>
          <div 
            style={{ 
                animation: stingerAnim === 'in' 
                    ? 'emphasisIn 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
                    : 'emphasisOut 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
            }}
          >
              <div className="flex flex-col items-center">
                  {tournament?.logoUrl ? <img src={tournament.logoUrl} className="w-48 h-48 sm:w-64 sm:h-64 object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]" /> : <div className="text-[10rem] sm:text-[14rem] drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">🏐</div>}
              </div>
          </div>
      </div>
      )}


      {/* UI Toggle Button (Always visible but subtle) */}
      {!isViewer && (
        <div className="absolute top-4 right-4 z-[60]">
            <button 
                onClick={() => setShowUI(!showUI)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${showUI ? 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white' : 'bg-red-600 text-white animate-pulse shadow-lg'}`}
                title={showUI ? "Ocultar Interfaz (Modo Limpio)" : "Mostrar Interfaz"}
            >
                {showUI ? '👁️' : '👁️‍🗨️'}
            </button>
        </div>
      )}

      {/* --- HEADER ELEMENTS (TOP LEFT) - NAV BAR --- */}
      {showUI && (
      <div className="absolute top-4 left-4 md:top-6 md:left-6 landscape:top-3 landscape:left-4 landscape:scale-90 flex flex-col gap-3 z-50 items-start transition-all">
          
          {/* NAVIGATION BUTTONS */}
          <div className="flex flex-col gap-2">
              {!isViewer && (
                  // Admin: Back to Controls
                  <div className="flex items-center gap-2">
                    <button 
                        onClick={onExit}
                        className="bg-corp-accent hover:bg-corp-accent-hover text-white px-5 py-3 rounded-lg text-xs font-black transition backdrop-blur-md border border-white/20 uppercase tracking-widest shadow-[0_0_15px_rgba(59,130,246,0.5)] flex items-center gap-2 transform hover:scale-105 active:scale-95"
                    >
                        <span>🎛️</span> Volver
                    </button>
                  </div>
              )}
          </div>

          {/* STATUS BADGES */}
          {!matchEnded && (
              <div className="hidden md:flex gap-2"> 
                  {!isPreMatch && (
                   <div className="bg-black/60 text-white px-3 py-1 rounded font-bold text-sm backdrop-blur-md border border-white/10 uppercase tracking-wider">
                      SET {match.currentSet}
                   </div>
                  )}
                  {!isCloudConnected && (
                      <div className="bg-yellow-500 text-black px-3 py-1 rounded font-bold text-xs uppercase animate-bounce shadow-lg">
                          ⚠️ Sin Conexión
                      </div>
                  )}
                  {/* NEXT SET BUTTON IN OVERLAY */}
                  {isSetFinished && isAdmin && onNextSet && (
                      <button 
                        onClick={onNextSet}
                        className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-bold text-xs uppercase animate-pulse shadow-lg flex items-center gap-1"
                      >
                        ▶ Siguiente Set {nextSetCountdown ? `(${nextSetCountdown})` : ''}
                      </button>
                  )}
              </div>
          )}
      </div>
      )}
      {tournament?.logoUrl && (
          <div className={`absolute z-40 transition-all duration-500 pointer-events-none origin-top-right
              ${isVertical 
                  ? 'bottom-4 right-4 scale-100 origin-bottom-right rotate-90' 
                  : 'top-6 right-4 scale-100'
              }
          `}>
              <img 
                src={tournament.logoUrl} 
                alt="Torneo" 
                className="h-16 w-16 md:h-24 md:w-24 object-contain drop-shadow-2xl opacity-100" 
              />
          </div>
      )}

      {/* --- ROTATION OVERLAY (COURT VISUALIZATION) --- */}
      {activeShowRotation && (
          <RotationView 
            teamA={teamA} 
            teamB={teamB} 
            rotationA={match.rotationA} 
            rotationB={match.rotationB} 
            isVertical={isVertical} 
          />
      )}

      {/* --- CONSTRUCTION EFFECT (VNL STYLE - STATS GRID) --- */}
      {isConstructing && (
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-5xl px-2 z-40 pointer-events-none
            ${isVertical ? 'rotate-90 scale-[0.85] origin-center h-[50vh] w-[85vh]' : 'scale-90 md:scale-100'}
        `}>
             <div className="relative w-full h-[400px] flex items-center justify-center">
                
                {/* 1. Main Horizontal Lines (Top/Bottom) - Draw from center out */}
                <div className="absolute top-0 left-1/2 w-full h-[2px] bg-white transform -translate-x-1/2 animate-[slideInLeft_0.4s_ease-out_forwards] origin-center scale-x-0 shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
                <div className="absolute bottom-0 left-1/2 w-full h-[2px] bg-white transform -translate-x-1/2 animate-[slideInRight_0.4s_ease-out_forwards] origin-center scale-x-0 shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
                
                {/* 2. Main Vertical Lines (Left/Right) - Draw from center out */}
                <div className="absolute left-0 top-1/2 h-full w-[2px] bg-white transform -translate-y-1/2 animate-[scaleY_0.4s_ease-out_0.2s_forwards] origin-center scale-y-0 shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
                <div className="absolute right-0 top-1/2 h-full w-[2px] bg-white transform -translate-y-1/2 animate-[scaleY_0.4s_ease-out_0.2s_forwards] origin-center scale-y-0 shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>

                {/* 3. Internal Grid Lines - Creating the "Construction" feel */}
                {/* Horizontal Dividers */}
                <div className="absolute top-1/4 left-0 w-full h-[1px] bg-white/50 animate-[slideInLeft_0.5s_ease-out_0.3s_forwards] origin-left scale-x-0"></div>
                <div className="absolute top-2/4 left-0 w-full h-[1px] bg-white/50 animate-[slideInRight_0.5s_ease-out_0.4s_forwards] origin-right scale-x-0"></div>
                <div className="absolute top-3/4 left-0 w-full h-[1px] bg-white/50 animate-[slideInLeft_0.5s_ease-out_0.5s_forwards] origin-left scale-x-0"></div>

                {/* Vertical Dividers */}
                <div className="absolute top-0 left-1/4 h-full w-[1px] bg-white/50 animate-[scaleY_0.5s_ease-out_0.3s_forwards] origin-top scale-y-0"></div>
                <div className="absolute top-0 left-2/4 h-full w-[1px] bg-white/50 animate-[scaleY_0.5s_ease-out_0.4s_forwards] origin-bottom scale-y-0"></div>
                <div className="absolute top-0 left-3/4 h-full w-[1px] bg-white/50 animate-[scaleY_0.5s_ease-out_0.5s_forwards] origin-top scale-y-0"></div>

                {/* 4. Intersection Flashes */}
                <div className="absolute top-0 left-0 w-2 h-2 bg-white rounded-full animate-[ping_0.3s_ease-out_0.2s_forwards] opacity-0"></div>
                <div className="absolute top-0 right-0 w-2 h-2 bg-white rounded-full animate-[ping_0.3s_ease-out_0.2s_forwards] opacity-0"></div>
                <div className="absolute bottom-0 left-0 w-2 h-2 bg-white rounded-full animate-[ping_0.3s_ease-out_0.2s_forwards] opacity-0"></div>
                <div className="absolute bottom-0 right-0 w-2 h-2 bg-white rounded-full animate-[ping_0.3s_ease-out_0.2s_forwards] opacity-0"></div>

                {/* Central Loading Text */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-white font-mono text-xs tracking-[0.5em] animate-pulse bg-black/50 px-4 py-1 border border-white/30">LOADING STATS...</span>
                </div>
             </div>
        </div>
      )}

      {/* --- COMPARATIVE STATS OVERLAY (VNL STYLE) --- */}
      {activeShowStatsOverlay && !matchEnded && !activeShowRotation && (
        <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full max-w-5xl px-2 z-40 transition-transform 
            ${isVertical ? 'rotate-90 scale-[0.85] origin-center h-[50vh] w-[85vh] flex items-center justify-center' : 'scale-90 md:scale-100'}
        `}>
            <div className="relative w-full max-w-3xl mx-auto">
                
                {/* Floating Logo Box - Positioned absolutely to the left of the stats table */}
                <div className="absolute -left-24 top-14 z-30 shadow-2xl hidden md:block">
                    <div className="bg-[#1e3a8a] w-28 h-28 flex items-center justify-center border-4 border-white">
                         {tournament?.logoUrl ? (
                             <img src={tournament.logoUrl} className="w-24 h-24 object-contain" />
                         ) : (
                             <div className="text-white font-black text-center leading-none">
                                 <div className="text-4xl italic">VNL</div>
                                 <div className="text-[9px] tracking-widest uppercase mt-1">Volleyball<br/>Nations League</div>
                             </div>
                         )}
                    </div>
                </div>
                {/* Mobile Logo - Visible only on small screens, positioned differently or hidden to save space */}
                <div className="absolute -left-4 top-14 z-30 shadow-2xl md:hidden scale-75 origin-right">
                     <div className="bg-[#1e3a8a] w-20 h-20 flex items-center justify-center border-2 border-white">
                         {tournament?.logoUrl ? (
                             <img src={tournament.logoUrl} className="w-16 h-16 object-contain" />
                         ) : (
                             <div className="text-white font-black text-center leading-none">
                                 <div className="text-2xl italic">VNL</div>
                             </div>
                         )}
                    </div>
                </div>

                {/* Main Content Column */}
                <div className="flex flex-col w-full">
                    
                    {/* Top Labels Row */}
                    <div className="flex items-end pl-0 md:pl-0 relative z-20">
                        {(() => {
                            const isGeneral = match.statsSetIndex === undefined;
                            const activeSetLabel = isGeneral ? 'PARTIDO' : `SET ${match.statsSetIndex! + 1}`;
                            const titleLabel = isGeneral ? 'MATCH STATS' : 'SET STATS';
                            return (
                                <>
                                {/* Set Label */}
                                <div className="bg-[#ef4444] text-white h-14 px-8 flex items-center justify-center border-4 border-white border-b-0 shadow-md ml-16 md:ml-0">
                                    <span className="font-black italic text-3xl uppercase tracking-tighter drop-shadow-md">
                                        {activeSetLabel}
                                    </span>
                                </div>

                                {/* Team Stats Label */}
                                <div className="bg-white text-[#1e3a8a] h-10 px-6 flex items-center justify-center border-t-4 border-r-4 border-white shadow-sm mb-0">
                                    <span className="font-black italic text-sm uppercase tracking-widest">
                                        {titleLabel}
                                    </span>
                                </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* Main Stats Container */}
                    <div className="bg-white border-4 border-white shadow-2xl relative z-10">
                        
                        {/* Team Header Row */}
                        <div className="flex h-16 relative border-b-2 border-white">
                            {/* Team A Name Bar */}
                            <div className="flex-1 bg-[#1e3a8a] flex items-center justify-center relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-3 bg-[#facc15]"></div> {/* Yellow Accent */}
                                <span className="text-white font-black italic text-3xl uppercase tracking-tighter z-10 drop-shadow-md">{teamA.name}</span>
                            </div>

                            {/* Scores Center */}
                            <div className="w-40 flex relative z-20">
                                {(() => {
                                    const isGeneral = match.statsSetIndex === undefined;
                                    const scoreA = isGeneral ? winsA : ((match.sets[match.statsSetIndex!]?.scoreA) || 0);
                                    const scoreB = isGeneral ? winsB : ((match.sets[match.statsSetIndex!]?.scoreB) || 0);
                                    return (
                                        <>
                                        <div className="flex-1 bg-[#ef4444] flex items-center justify-center border-r-2 border-white">
                                            <span className="text-white font-black text-4xl">{scoreA}</span>
                                        </div>
                                        <div className="flex-1 bg-[#ef4444] flex items-center justify-center">
                                            <span className="text-white font-black text-4xl">{scoreB}</span>
                                        </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* Team B Name Bar */}
                            <div className="flex-1 bg-[#1e3a8a] flex items-center justify-center relative overflow-hidden">
                                <div className="absolute right-0 top-0 bottom-0 w-3 bg-[#ef4444]"></div> {/* Red Accent */}
                                <span className="text-white font-black italic text-3xl uppercase tracking-tighter z-10 drop-shadow-md">{teamB.name}</span>
                            </div>
                        </div>

                        {/* Stats Rows */}
                        <div className="flex flex-col">
                            {[
                                { l: sets.filter(s => s.scoreA > s.scoreB).length, label: 'SETS', r: sets.filter(s => s.scoreB > s.scoreA).length },
                                { l: statsA.attacks, label: 'ATTACKS', r: statsB.attacks },
                                { l: statsA.blocks, label: 'BLOCKS', r: statsB.blocks },
                                { l: statsA.aces, label: 'SERVES', r: statsB.aces },
                                { l: statsA.errors, label: 'OPPONENT ERRORS', r: statsB.errors }
                            ].map((row, idx) => (
                                <div key={idx} className={`flex h-12 items-center border-b border-white/10 ${idx % 2 === 0 ? 'bg-[#dc2626]' : 'bg-[#1e3a8a]'}`}>
                                    {/* Team A Value */}
                                    <div className="flex-1 text-center">
                                        <span className="text-white font-black text-2xl drop-shadow-sm">{row.l}</span>
                                    </div>

                                    {/* Label */}
                                    <div className="w-56 text-center">
                                        <span className="text-white font-bold text-base uppercase tracking-widest opacity-100 drop-shadow-md">{row.label}</span>
                                    </div>

                                    {/* Team B Value */}
                                    <div className="flex-1 text-center">
                                        <span className="text-white font-black text-2xl drop-shadow-sm">{row.r}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- PRE-MATCH / WARMUP BANNER & TEAM VS (COMPACT MODE) --- */}
      {(isPreMatch || isSetFinished) && !matchEnded && (
          <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 w-[90%] max-w-4xl z-30 animate-in slide-in-from-bottom-10 duration-700">
             {/* Compact Pre-Match Bar - Allows full camera visibility */}
            <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-2xl overflow-hidden shadow-2xl flex items-stretch h-20 md:h-24">
                
                {/* Team A */}
                <div className="flex-1 flex items-center justify-end px-4 md:px-6 gap-3 md:gap-4 bg-gradient-to-r from-transparent to-blue-900/30">
                    <h3 className="hidden md:block text-xl md:text-2xl font-black text-white uppercase italic tracking-tighter text-right leading-none">{teamA.name}</h3>
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/10 rounded-lg p-1 md:p-2 border border-white/10 shadow-lg">
                        {teamA.logoUrl ? (
                            <img src={teamA.logoUrl} className="w-full h-full object-contain" /> 
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-black text-blue-400">{teamA.name[0]}</div>
                        )}
                    </div>
                </div>

                {/* Center VS / Status */}
                <div className="w-32 md:w-40 flex flex-col items-center justify-center bg-black/50 border-x border-white/10 relative">
                     <div className="absolute inset-0 bg-gradient-to-t from-red-900/20 to-transparent animate-pulse"></div>
                     <span className="text-2xl md:text-4xl font-black text-yellow-400 italic drop-shadow-lg">VS</span>
                     <span className="text-[9px] md:text-[10px] font-bold text-white uppercase tracking-widest bg-red-600/80 px-2 py-0.5 rounded mt-1">
                        {isSetFinished ? 'INTERMEDIO' : 'Calentamiento'}
                     </span>
                </div>

                {/* Team B */}
                <div className="flex-1 flex items-center justify-start px-4 md:px-6 gap-3 md:gap-4 bg-gradient-to-l from-transparent to-red-900/30">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white/10 rounded-lg p-1 md:p-2 border border-white/10 shadow-lg">
                        {teamB.logoUrl ? (
                            <img src={teamB.logoUrl} className="w-full h-full object-contain" /> 
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-black text-red-400">{teamB.name[0]}</div>
                        )}
                    </div>
                    <h3 className="hidden md:block text-xl md:text-2xl font-black text-white uppercase italic tracking-tighter text-left leading-none">{teamB.name}</h3>
                </div>

            </div>
          </div>
      )}

      {/* VERSUS OVERLAY (PLAYER vs PLAYER) */}
      {!!activeTvSettings?.showVersus && (() => {
          let pA: typeof teamA.players[0] | undefined = undefined;
          let pB: typeof teamA.players[0] | undefined = undefined;

          // FIRST, calculate scores for ALL players to make informed decisions
          const currSet = match.sets[match.currentSet - 1] || { history: [] };
          const scoresA:Record<string, {pts:number, att:number, blk:number, srv:number, attTot:number}> = {};
          const scoresB:Record<string, {pts:number, att:number, blk:number, srv:number, attTot:number}> = {};
          
          teamA.players.forEach(p => scoresA[p.id] = {pts:0, att:0, blk:0, srv:0, attTot:0 });
          teamB.players.forEach(p => scoresB[p.id] = {pts:0, att:0, blk:0, srv:0, attTot:0 });

          const setHistory = currSet.history || [];
          setHistory.forEach(h => {
              if(h.playerId) {
                  let sc = h.teamId === teamA.id ? scoresA[h.playerId] : scoresB[h.playerId];
                  if(sc) {
                      if(['attack','block','ace'].includes(h.type)) sc.pts++;
                      if(h.type==='attack') { sc.att++; sc.attTot++; }
                      if(h.type==='block') sc.blk++;
                      if(h.type==='ace') sc.srv++;
                  }
              }
          });
          
          if (typeof activeTvSettings.showVersus === 'string' && activeTvSettings.showVersus !== 'auto') {
               // Find best by specific role
               const roleFilter = activeTvSettings.showVersus;
               let candidatesA = teamA.players.filter(p => p.role === roleFilter);
               let candidatesB = teamB.players.filter(p => p.role === roleFilter);
               
               // Sort by highest points
               candidatesA.sort((a,b) => (scoresA[b.id]?.pts || 0) - (scoresA[a.id]?.pts || 0));
               candidatesB.sort((a,b) => (scoresB[b.id]?.pts || 0) - (scoresB[a.id]?.pts || 0));
               
               pA = candidatesA[0] || teamA.players[0]; // fallback
               pB = candidatesB[0] || teamB.players[0]; // fallback
          } else {
              pA = activeTvSettings.featuredPlayerId ? teamA.players.find(p => p.id === activeTvSettings?.featuredPlayerId) : undefined;
              if (!pA) {
                  pA = teamB.players.find(p => p.id === activeTvSettings?.featuredPlayerId);
                  if (pA) {
                     // Swap if selected player is from team B
                     pB = pA;
                     pA = undefined;
                  }
              }

              // Fallbacks for Player A and B
              if (!pA && !pB) {
                  let bestAId = teamA.players[0]?.id; let maxA = -1;
                  Object.entries(scoresA).forEach(([id, st]) => { if(st.pts > maxA) { maxA=st.pts; bestAId=id; }});
                  pA = teamA.players.find(p => p.id === bestAId) || teamA.players[0];
              }

              if (pA && !pB) {
                  // Find best matching role on Team B
                  const roleMatches = teamB.players.filter(p => p.role === pA?.role);
                  let bestBId = roleMatches[0]?.id || teamB.players[0]?.id; let maxB = -1;
                  roleMatches.forEach(p => { if((scoresB[p.id]?.pts || 0) > maxB) { maxB=(scoresB[p.id]?.pts || 0); bestBId=p.id; }});
                  pB = teamB.players.find(p => p.id === bestBId) || teamB.players[0];
              } else if (pB && !pA) {
                  const roleMatches = teamA.players.filter(p => p.role === pB?.role);
                  let bestAId = roleMatches[0]?.id || teamA.players[0]?.id; let maxA = -1;
                  roleMatches.forEach(p => { if((scoresA[p.id]?.pts || 0) > maxA) { maxA=(scoresA[p.id]?.pts || 0); bestAId=p.id; }});
                  pA = teamA.players.find(p => p.id === bestAId) || teamA.players[0];
              }
          }

          if (!pA || !pB) return null;

          const stA = scoresA[pA.id] || {pts:0,att:0,blk:0,srv:0,attTot:1};
          const stB = scoresB[pB.id] || {pts:0,att:0,blk:0,srv:0,attTot:1};

          const effA = stA.attTot > 0 ? Math.round((stA.att/stA.attTot)*100) : 0;
          const effB = stB.attTot > 0 ? Math.round((stB.att/stB.attTot)*100) : 0;

          const rows = [
              { label: 'ROLE', l: pA.role, r: pB.role },
              { label: 'AGE', l: pA.profile?.birthDate ? (new Date().getFullYear() - new Date(pA.profile.birthDate).getFullYear()) : '-', r: pB.profile?.birthDate ? (new Date().getFullYear() - new Date(pB.profile.birthDate).getFullYear()) : '-' },
              { label: 'HEIGHT', l: pA.profile?.height ? pA.profile.height+' cm' : '-', r: pB.profile?.height ? pB.profile.height+' cm' : '-' },
              { label: 'TOTAL POINTS', l: stA.pts, r: stB.pts },
              { label: 'EFFICIENCY', l: effA+'%', r: effB+'%' },
              { label: 'ATTACKS IN', l: stA.att, r: stB.att },
              { label: 'BLOCKS', l: stA.blk, r: stB.blk },
              { label: 'SERVES', l: stA.srv, r: stB.srv },
          ];

          return (
          <div className="fixed inset-0 z-50 flex flex-col pointer-events-none items-center justify-center p-4 bg-transparent animate-in slide-in-from-bottom duration-500">
             <div className="relative flex flex-col items-center w-full max-w-5xl">
                 <div className="flex flex-col items-center mb-6 drop-shadow-xl">
                     <h2 className="text-7xl font-black text-white italic tracking-tighter uppercase relative">
                        <span className="absolute -left-[5rem] -top-8 text-[#827DFF] text-xl opacity-50 tracking-tighter">VOLLEYTV</span>
                        TOP PLAYERS
                     </h2>
                     <span className="text-white font-bold tracking-[0.3em] text-sm mt-1">SET {match.currentSet}</span>
                 </div>
                 <div className="flex w-full items-end justify-center h-[50vh]">
                     {/* LEFT PLAYER */}
                     <div className="w-[30%] h-[120%] relative flex justify-center">
                         {pA.profile?.photoUrl ? (
                            <img src={pA.profile.photoUrl} className="absolute bottom-0 h-full object-contain mb-8 z-20 drop-shadow-2xl translate-x-12"/>
                         ) : (
                            <div className="absolute bottom-16 w-48 h-48 bg-white border-2 border-white/20 rounded shadow overflow-hidden flex items-center justify-center z-20 translate-x-8">
                                {teamA.logoUrl ? <img src={teamA.logoUrl} className="w-full h-full object-cover"/> : <div className="text-black font-black text-6xl">{teamA.name.substring(0,3).toUpperCase()}</div>}
                            </div>
                         )}
                         <div className="absolute bottom-0 text-white font-black italic text-4xl bg-[#4C8BFF] px-6 py-2 rounded-t z-30 shadow-2xl flex items-center gap-2 pr-12 translate-x-4">
                            <span>{pA.role} {pA.number}</span>
                            <div className="text-3xl ml-2 drop-shadow-md">{pA.name.split(' ')[0]}</div>
                         </div>
                     </div>
                     {/* STATS BOARD */}
                     <div className="w-[50%] bg-gradient-to-br from-[#1b143c] to-[#0e0c1f] rounded-t-xl overflow-hidden shadow-[0_-10px_40px_rgba(0,0,0,0.8)] border border-white/10 z-10 relative flex flex-col">
                         <div className="flex justify-between items-center py-2 px-8 bg-black/40">
                             <div className="w-12 h-6 border bg-white flex items-center justify-center overflow-hidden">
                                 {teamA.logoUrl ? <img src={teamA.logoUrl} className="object-cover h-full w-full"/> : teamA.name.substring(0,3)}
                             </div>
                             <div className="w-12 h-6 border bg-white flex items-center justify-center overflow-hidden">
                                 {teamB.logoUrl ? <img src={teamB.logoUrl} className="object-cover h-full w-full"/> : teamB.name.substring(0,3)}
                             </div>
                         </div>
                         <div className="flex flex-col py-4 gap-1">
                             {rows.map((r, i) => (
                                 <div key={i} className="flex font-black text-lg h-9">
                                     <div className="flex-1 bg-gradient-to-r from-[#170a4a] to-[#251bc2] flex items-center justify-start px-6 text-white drop-shadow-md">
                                         {r.l}
                                     </div>
                                     <div className="w-1/3 bg-[#3f3178]/20 flex items-center justify-center text-[#c2bdf0] tracking-widest text-sm font-bold">
                                         {r.label}
                                     </div>
                                     <div className="flex-1 bg-gradient-to-l from-[#4a0a1a] to-[#c21b44] flex items-center justify-end px-6 text-white drop-shadow-md">
                                         {r.r}
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </div>
                     {/* RIGHT PLAYER */}
                     <div className="w-[30%] h-[120%] relative flex justify-center">
                         {pB.profile?.photoUrl ? (
                            <img src={pB.profile.photoUrl} className="absolute bottom-0 h-full object-contain mb-8 z-20 drop-shadow-2xl -translate-x-12 scale-x-[-1]"/>
                         ) : (
                            <div className="absolute bottom-16 w-48 h-48 bg-white border-2 border-white/20 rounded shadow overflow-hidden flex items-center justify-center z-20 -translate-x-8">
                                {teamB.logoUrl ? <img src={teamB.logoUrl} className="w-full h-full object-cover"/> : <div className="text-black font-black text-6xl">{teamB.name.substring(0,3).toUpperCase()}</div>}
                            </div>
                         )}
                         <div className="absolute bottom-0 text-[#251bc2] font-black italic text-4xl bg-white px-6 py-2 rounded-t z-30 shadow-2xl flex items-center gap-2 pl-12 -translate-x-4">
                            <div className="text-3xl mr-2 drop-shadow-md">{pB.name.split(' ')[0]}</div>
                            <span>{pB.role} {pB.number}</span>
                         </div>
                     </div>
                 </div>
             </div>
          </div>
          );
      })()}

      {/* HAWK EYE EFFECT */}
      {activeTvSettings?.hawkEyeStatus && (
          <div className="absolute bottom-8 left-8 z-40 pointer-events-none flex items-center justify-center animate-in zoom-in slide-in-from-left duration-500">
              <div className="flex flex-col items-center justify-center gap-2 relative z-10 w-[300px] h-[340px] border-2 border-slate-500/50 bg-[#0f111a]/95 shadow-[0_0_30px_rgba(0,0,0,0.9)] rounded-xl overflow-hidden pointer-events-auto">
                  <div className="absolute top-0 w-full h-1 bg-blue-500"></div>
                  
                  <h2 className="text-xl font-black text-white italic tracking-[0.2em] mt-4 mb-2">CHALLENGE</h2>
                  
                  <div className="relative w-[280px] h-[180px] overflow-hidden bg-[#2582b5] rounded border border-white/10 shadow-inner">
                        {/* The Line */}
                        <div className="absolute top-[35%] w-full h-full bg-[#d96a32] border-t-[12px] border-white flex flex-col items-center shadow-[inset_0_10px_20px_rgba(0,0,0,0.2)]"></div>
                        
                        <div className="absolute bottom-[65%] w-full flex justify-center pb-2">
                             <span className="text-white/40 font-black uppercase tracking-[0.3em] text-2xl">OUT</span>
                        </div>
                        <div className="absolute top-[40%] w-full flex justify-center pt-2">
                             <span className="text-white/40 font-black uppercase tracking-[0.3em] text-2xl">IN</span>
                        </div>

                        {/* The Ball Animation */}
                        {activeTvSettings.hawkEyeStatus === 'in' ? (
                            <>
                                {/* Permanent impact mark */}
                                <div className="absolute w-12 h-6 rounded-[50%] bg-[#22c55e]/60 mix-blend-multiply opacity-0 shadow-[0_0_10px_#4ade80]" style={{top: '32%', left: '42%', animation: 'showMark 2s forwards 0.5s'}}></div>
                                
                                <div className="absolute w-10 h-10 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-full shadow-[0_10px_20px_rgba(0,0,0,0.8),inset_-2px_-2px_6px_rgba(0,0,0,0.3)] flex items-center justify-center pointer-events-none" style={{animation: 'dropInBall 3s cubic-bezier(0.2, 0, 0.8, 1) forwards'}}>
                                    <div className="w-full h-[1px] bg-black/20 rotate-45"></div>
                                    <div className="w-full h-[1px] bg-black/20 -rotate-45 absolute"></div>
                                </div>
                                <div className="absolute w-12 h-6 border-2 border-white rounded-[50%] opacity-0" style={{top: '32%', left: '42%', animation: 'ripple 1s ease-out 0.5s forwards'}}></div>
                            </>
                        ) : (
                            <>
                                {/* Permanent impact mark */}
                                <div className="absolute w-12 h-6 rounded-[50%] bg-[#ef4444]/60 mix-blend-multiply opacity-0 shadow-[0_0_10px_#ef4444]" style={{top: '20%', left: '55%', animation: 'showMark 2s forwards 0.5s'}}></div>
                                
                                <div className="absolute w-10 h-10 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-full shadow-[0_10px_20px_rgba(0,0,0,0.8),inset_-2px_-2px_6px_rgba(0,0,0,0.3)] flex items-center justify-center pointer-events-none" style={{animation: 'dropOutBall 3s cubic-bezier(0.2, 0, 0.8, 1) forwards'}}>
                                    <div className="w-full h-[1px] bg-black/20 rotate-45"></div>
                                    <div className="w-full h-[1px] bg-black/20 -rotate-45 absolute"></div>
                                </div>
                                <div className="absolute w-12 h-6 border-2 border-white rounded-[50%] opacity-0" style={{top: '20%', left: '55%', animation: 'ripple 1s ease-out 0.5s forwards'}}></div>
                            </>
                        )}
                        <style>{`
                          @keyframes dropInBall { 
                              0% { top: -20%; left: 120%; transform: scale(3) rotate(0deg); opacity: 0; filter: blur(5px); } 
                              10% { opacity: 1; filter: blur(2px); }
                              45% { top: 32%; left: 45%; transform: scale(0.9) rotate(200deg); filter: blur(0px); }
                              48% { top: 35%; left: 43%; transform: scaleX(1.3) scaleY(0.7) rotate(220deg); filter: blur(0px); }
                              52% { top: 30%; left: 42%; transform: scaleX(0.9) scaleY(1.1) rotate(240deg); filter: blur(1px); }
                              70% { top: -100px; left: -20%; transform: scale(2) rotate(400deg); opacity: 1; filter: blur(3px); }
                              100% { top: -100px; left: -20%; transform: scale(2) rotate(400deg); opacity: 0; }
                          }
                          @keyframes dropOutBall { 
                              0% { top: -20%; left: 120%; transform: scale(3) rotate(0deg); opacity: 0; filter: blur(5px); } 
                              10% { opacity: 1; filter: blur(2px); }
                              45% { top: 20%; left: 57%; transform: scale(0.9) rotate(200deg); filter: blur(0px); }
                              48% { top: 22%; left: 56%; transform: scaleX(1.3) scaleY(0.7) rotate(220deg); filter: blur(0px); }
                              52% { top: 18%; left: 55%; transform: scaleX(0.9) scaleY(1.1) rotate(240deg); filter: blur(1px); }
                              70% { top: -100px; left: 10%; transform: scale(2) rotate(400deg); opacity: 1; filter: blur(3px); }
                              100% { top: -100px; left: 10%; transform: scale(2) rotate(400deg); opacity: 0; }
                          }
                          @keyframes showMark {
                              0% { opacity: 0; transform: scale(0.2); }
                              60% { opacity: 0.8; transform: scale(1.1); }
                              100% { opacity: 0.8; transform: scale(1); }
                          }
                          @keyframes ripple {
                              0% { transform: scale(0.5); opacity: 1; border-width: 4px; }
                              100% { transform: scale(4); opacity: 0; border-width: 0px; }
                          }
                        `}</style>
                  </div>

                  {activeTvSettings.hawkEyeStatus === 'in' ? (
                      <div className="animate-in fade-in zoom-in delay-1000 duration-500 fill-mode-both flex flex-col items-center pb-2 mt-2">
                          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-green-300 to-green-600 drop-shadow-[0_0_20px_rgba(34,197,94,0.8)] leading-none">IN</h1>
                          <p className="text-green-400 font-bold text-xs tracking-[0.3em] mt-1">DENTRO</p>
                      </div>
                  ) : (
                      <div className="animate-in fade-in zoom-in delay-1000 duration-500 fill-mode-both flex flex-col items-center pb-2 mt-2">
                          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-red-400 to-red-600 drop-shadow-[0_0_20px_rgba(220,38,38,0.8)] leading-none">OUT</h1>
                          <p className="text-red-400 font-bold text-xs tracking-[0.3em] mt-1">FUERA</p>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* FEATURED PLAYER EFFECT */}
      {activeTvSettings?.featuredPlayerId && activeTvSettings.featuredPlayerMode === 'presentation' && (
          <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in zoom-in duration-500">
             {(() => {
                 const player = match.rotationA.find(p => p.id === activeTvSettings!.featuredPlayerId) || 
                                match.benchA.find(p => p.id === activeTvSettings!.featuredPlayerId) || 
                                match.rotationB.find(p => p.id === activeTvSettings!.featuredPlayerId) || 
                                match.benchB.find(p => p.id === activeTvSettings!.featuredPlayerId);
                 if (!player) return null;
                 
                 const pTeam = [...match.rotationA, ...match.benchA].some(p => p.id === player.id) ? teamA : teamB;
                 const isPresentation = activeTvSettings.featuredPlayerMode === 'presentation';

                 // Calculate simplistic stats
                 const acts = match.sets.flatMap(s => s.history).filter(h => h.playerId === player.id);
                 const kills = acts.filter(h => h.type === 'attack').length;
                 const blocks = acts.filter(h => h.type === 'block').length;
                 const aces = acts.filter(h => h.type === 'ace').length;
                 const pts = kills + blocks + aces;

                 return (
                     <div className="w-[90vw] max-w-4xl bg-gradient-to-br from-black/90 to-slate-900 border border-white/20 rounded-2xl shadow-[0_0_50px_rgba(255,255,255,0.1)] overflow-hidden flex relative">
                         {/* Player Image Side */}
                         <div className="w-1/2 relative bg-gray-800 flex items-center justify-center min-h-[400px] border-r border-white/10">
                             {player.profile?.photoUrl ? (
                                 <img src={player.profile.photoUrl} className="absolute w-full h-full object-cover opacity-80 mix-blend-luminosity" />
                             ) : (
                                 <span className="text-[10rem] opacity-20">👤</span>
                             )}
                             <p className="absolute bottom-4 left-4 text-[6rem] font-black text-white/10 italic leading-none">{player.number}</p>
                         </div>
                         
                         {/* Info Side */}
                         <div className="w-1/2 p-8 flex flex-col justify-center">
                             <div className="mb-6">
                                 <h2 className="text-6xl font-black text-white uppercase italic tracking-tighter leading-none">{player.name}</h2>
                                 <p className="text-xl font-bold text-vnl-accent uppercase tracking-widest mt-2">{player.role} | {pTeam.name}</p>
                             </div>
                             
                             {isPresentation ? (
                                 <div className="space-y-4 animate-in slide-in-from-right-8 delay-150">
                                     <div className="bg-white/5 p-4 rounded border-l-4 border-vnl-accent">
                                         <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Nacionalidad</p>
                                         <p className="text-2xl font-black text-white">N/A</p>
                                     </div>
                                     <div className="bg-white/5 p-4 rounded border-l-4 border-yellow-500">
                                         <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Altura</p>
                                         <p className="text-2xl font-black text-white">{player.profile?.height || 'N/A'} cm</p>
                                     </div>
                                 </div>
                             ) : (
                                 <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-right-8 delay-150">
                                     <div className="col-span-2 bg-white/5 p-4 rounded border-l-4 border-vnl-accent flex justify-between items-center">
                                         <p className="text-sm text-slate-400 font-bold uppercase tracking-widest">Puntos Totales</p>
                                         <p className="text-4xl font-black text-white">{pts}</p>
                                     </div>
                                     <div className="bg-white/5 p-4 rounded flex flex-col items-center justify-center">
                                         <p className="text-3xl font-black text-white">{kills}</p>
                                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center mt-1">Ataques</p>
                                     </div>
                                     <div className="bg-white/5 p-4 rounded flex flex-col items-center justify-center">
                                         <p className="text-3xl font-black text-white">{blocks}</p>
                                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center mt-1">Bloqueos</p>
                                     </div>
                                     <div className="col-span-2 bg-white/5 p-4 rounded flex flex-col items-center justify-center">
                                         <p className="text-3xl font-black text-white">{aces}</p>
                                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center mt-1">Aces</p>
                                     </div>
                                 </div>
                             )}
                         </div>
                         {/* Watermark Logo */}
                         <div className="absolute top-4 right-4 opacity-30">
                             <img src={tournament?.logoUrl} className="w-16 h-16 object-contain grayscale" />
                         </div>
                     </div>
                 );
             })()}
          </div>
      )}



      {/* --- FORMATIONS OVERLAY --- */}
      {activeTvSettings?.showFormations && (
          <div className="fixed inset-0 z-40 flex flex-col pointer-events-none items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in zoom-in duration-500">
             <div className={`relative flex font-sans ${isVertical ? 'flex-col gap-4' : 'flex-row gap-12'}`}>
                {/* Team A Formation */}
                <div className="relative w-[30vh] h-[30vh] md:w-[45vh] md:h-[45vh]">
                   <div className="absolute -top-12 left-0 right-0 text-center font-black text-white uppercase tracking-widest text-lg md:text-2xl drop-shadow-[0_0_5px_rgba(130,125,255,1)]">{teamA.name}</div>
                   <div className="w-full h-full bg-[#182a47]/80 border border-blue-500/50 shadow-[0_0_50px_rgba(59,130,246,0.3)] origin-bottom rotate-x-[50deg] rounded-lg grid grid-cols-3 grid-rows-2 p-4 gap-4 relative">
                       {/* Attack Line */}
                       <div className="absolute top-1/3 left-0 right-0 h-1 bg-cyan-400/50 shadow-[0_0_10px_#22d3ee]"></div>
                       {[4,3,2,5,6,1].map((pos, i) => {
                          const player = match.rotationA[pos-1];
                          const isServing = match.servingTeamId === teamA.id && pos === 1;
                          return (
                             <div key={pos} className="flex items-center justify-center relative -rotate-x-[50deg]">
                                {player ? (
                                   <div className={`flex flex-col items-center animate-in zoom-in transition-transform hover:scale-110 ${isServing ? 'animate-[bounce_2s_infinite]' : ''}`} style={{animationDelay: `${i*100}ms`}}>
                                      {player.profile?.photoUrl ? (
                                         <img src={player.profile.photoUrl} className="w-12 h-12 md:w-20 md:h-20 rounded-full object-cover border-2 border-[#827DFF] shadow-[0_10px_20px_rgba(0,0,0,0.5)]" />
                                      ) : (
                                         <div className="w-12 h-12 md:w-20 md:h-20 rounded-full bg-[#18233f] border-2 border-[#827DFF] flex items-center justify-center text-white font-black text-xl shadow-[0_10px_20px_rgba(0,0,0,0.5)]">{player.number}</div>
                                      )}
                                      <span className="text-[10px] md:text-xs text-blue-100 font-bold bg-black/80 px-2 py-0.5 rounded mt-2 truncate max-w-[80px] shadow-lg border border-white/10 uppercase tracking-widest">{player.name.split(' ')[0]}</span>
                                      {isServing && <span className="absolute -bottom-4 bg-black/80 text-yellow-400 border border-yellow-400 px-2 rounded-full text-[8px] font-black tracking-widest mt-1">SAQUE</span>}
                                   </div>
                                ) : <div className="text-white/20 text-[8px] font-bold">POS {pos}</div>}
                             </div>
                          );
                       })}
                   </div>
                </div>
                
                {/* VS Center */}
                {!isVertical && (
                   <div className="w-1 md:w-2 bg-white/20 rounded-full h-[60%] self-center blur-[1px]"></div>
                )}

                {/* Team B Formation */}
                <div className="relative w-[30vh] h-[30vh] md:w-[45vh] md:h-[45vh]">
                   <div className={`absolute ${isVertical?'-top-12':'-top-12'} left-0 right-0 text-center font-black text-white uppercase tracking-widest text-lg md:text-2xl drop-shadow-[0_0_5px_rgba(76,139,255,1)]`}>{teamB.name}</div>
                   <div className="w-full h-full bg-[#3b1717]/80 border border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.3)] origin-bottom rotate-x-[50deg] rounded-lg grid grid-cols-3 grid-rows-2 p-4 gap-4 relative">
                       {/* Attack Line */}
                       <div className="absolute bottom-1/3 left-0 right-0 h-1 bg-rose-400/50 shadow-[0_0_10px_#fb7185]"></div>
                       {/* Note: reversed side for Team B so the net is in the middle logically if placed side by side */}
                       {[2,3,4,1,6,5].map((pos, i) => {
                          const player = match.rotationB[pos-1];
                          const isServing = match.servingTeamId === teamB.id && pos === 1;
                          return (
                             <div key={pos} className="flex items-center justify-center relative -rotate-x-[50deg]">
                                {player ? (
                                   <div className={`flex flex-col items-center animate-in zoom-in transition-transform hover:scale-110 ${isServing ? 'animate-[bounce_2s_infinite]' : ''}`} style={{animationDelay: `${i*100}ms`}}>
                                      {player.profile?.photoUrl ? (
                                         <img src={player.profile.photoUrl} className="w-12 h-12 md:w-20 md:h-20 rounded-full object-cover border-2 border-[#4C8BFF] shadow-[0_10px_20px_rgba(0,0,0,0.5)]" />
                                      ) : (
                                         <div className="w-12 h-12 md:w-20 md:h-20 rounded-full bg-[#3b1a1a] border-2 border-[#4C8BFF] flex items-center justify-center text-white font-black text-xl shadow-[0_10px_20px_rgba(0,0,0,0.5)]">{player.number}</div>
                                      )}
                                      <span className="text-[10px] md:text-xs text-red-100 font-bold bg-black/80 px-2 py-0.5 rounded mt-2 truncate max-w-[80px] shadow-lg border border-white/10 uppercase tracking-widest">{player.name.split(' ')[0]}</span>
                                      {isServing && <span className="absolute -bottom-4 bg-black/80 text-yellow-400 border border-yellow-400 px-2 rounded-full text-[8px] font-black tracking-widest mt-1">SAQUE</span>}
                                   </div>
                                ) : <div className="text-white/20 text-[8px] font-bold">POS {pos}</div>}
                             </div>
                          );
                       })}
                   </div>
                </div>
             </div>
          </div>
      )}

      {/* --- POINT EVOLUTION (TIMELINE) OVERLAY --- */}
      {activeTvSettings?.showPointEvolution && (
          <div className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 w-full max-w-5xl z-40 flex flex-col pointer-events-none items-center justify-center p-4 bg-transparent animate-in slide-in-from-bottom duration-500">
             <div className="relative w-full flex items-center justify-center drop-shadow-[0_0_30px_rgba(0,0,0,0.8)]">
                  {(() => {
                      const currSet = match.sets[match.currentSet - 1] || { history: [] };
                      const setHistory = currSet.history || [];
                      
                      const timeline: { a: number, b: number, whoScored: string }[] = [];
                      
                      const scoringEvents = setHistory.filter(h => 
                          h.type === 'attack' || h.type === 'block' || h.type === 'ace' || h.type === 'opponent_error' || h.type === 'red_card'
                      );

                      scoringEvents.forEach((h, index) => {
                          const [scoreAStr, scoreBStr] = h.scoreSnapshot.split('-');
                          const newA = parseInt(scoreAStr);
                          const newB = parseInt(scoreBStr);

                          let whoScored = '';
                          const prevA = index > 0 ? timeline[index-1].a : 0;
                          const prevB = index > 0 ? timeline[index-1].b : 0;
                          
                          if (newA > prevA && newB === prevB) {
                              whoScored = teamA.id;
                          } else if (newB > prevB && newA === prevA) {
                              whoScored = teamB.id;
                          } else {
                              if (h.type === 'opponent_error' || h.type === 'red_card') {
                                  whoScored = h.teamId === teamA.id ? teamB.id : teamA.id;
                              } else {
                                  whoScored = h.teamId;
                              }
                          }
                          timeline.push({ a: newA, b: newB, whoScored });
                      });

                      const maxColumns = 12; 
                      const reversedDisplay = [...timeline].reverse();
                      const historyDisplay = reversedDisplay.slice(0, maxColumns);

                      return (
                          <div className="flex flex-col rounded overflow-hidden shadow-2xl relative w-full border-2 border-white/10">
                              <div className="flex h-12 md:h-16 text-white bg-gradient-to-r from-[#82193b] to-[#400e23] border-b border-white/20">
                                  <div className="w-48 flex items-center justify-between px-4 shrink-0">
                                      <div className="w-10 h-6 bg-white flex items-center justify-center overflow-hidden">
                                          {teamA.logoUrl ? <img src={teamA.logoUrl} className="object-cover w-full h-full" /> : <div className="text-black font-black text-[10px]">{teamA.name.substring(0,3)}</div>}
                                      </div>
                                      <span className="font-black text-3xl italic tracking-tighter drop-shadow-md">{teamA.name.substring(0,3).toUpperCase()}</span>
                                  </div>
                                  <div className="w-16 md:w-20 bg-[#1c38fa] flex items-center justify-center text-3xl md:text-5xl font-black tabular-nums border-x border-white/20 shrink-0 shadow-2xl z-20">
                                      {match.scoreA}
                                  </div>
                                  {historyDisplay.map((pointState, i) => (
                                      <div key={i} className={`flex-1 flex items-center justify-center border-r border-[#ffffff15] text-xl md:text-3xl font-black ${pointState.whoScored === teamA.id ? 'text-white bg-[#ffffff10]' : 'text-white/50'}`}>
                                          {pointState.a}
                                      </div>
                                  ))}
                                  {/* Fill empty columns if needed */}
                                  {Array.from({length: Math.max(0, maxColumns - historyDisplay.length)}).map((_, i) => (
                                      <div key={'e'+i} className="flex-1 flex items-center justify-center border-r border-[#ffffff15]"></div>
                                  ))}
                              </div>

                              <div className="flex h-12 md:h-16 text-white bg-gradient-to-r from-[#100742] to-[#0a0521]">
                                  <div className="w-48 flex items-center justify-between px-4 shrink-0">
                                      <div className="w-10 h-6 bg-white flex items-center justify-center overflow-hidden">
                                          {teamB.logoUrl ? <img src={teamB.logoUrl} className="object-cover w-full h-full" /> : <div className="text-black font-black text-[10px]">{teamB.name.substring(0,3)}</div>}
                                      </div>
                                      <span className="font-black text-3xl italic tracking-tighter drop-shadow-md">{teamB.name.substring(0,3).toUpperCase()}</span>
                                  </div>
                                  <div className="w-16 md:w-20 bg-[#1c38fa] flex items-center justify-center text-3xl md:text-5xl font-black tabular-nums border-x border-white/20 shrink-0 shadow-2xl z-20">
                                      {match.scoreB}
                                  </div>
                                  {historyDisplay.map((pointState, i) => (
                                      <div key={i} className={`flex-1 flex items-center justify-center border-r border-[#ffffff15] text-xl md:text-3xl font-black ${pointState.whoScored === teamB.id ? 'text-white bg-[#ffffff10]' : 'text-white/50'}`}>
                                          {pointState.b}
                                      </div>
                                  ))}
                                  {Array.from({length: Math.max(0, maxColumns - historyDisplay.length)}).map((_, i) => (
                                      <div key={'e'+i} className="flex-1 flex items-center justify-center border-r border-[#ffffff15]"></div>
                                  ))}
                              </div>
                          </div>
                      );
                  })()}
             </div>
          </div>
      )}
      {/* SERVE SPEED OVERLAY */}
      {activeTvSettings?.showServeSpeed && (
          <div className="fixed bottom-32 right-12 z-40 animate-in slide-in-from-right fade-in pointer-events-none">
              <div className="bg-gradient-to-br from-black/80 to-slate-900 border border-emerald-500/30 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] p-4 w-64 backdrop-blur-md">
                  <div className="flex justify-between items-center mb-4">
                      <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Saque</span>
                      <span className="text-[10px] font-bold text-white/50">{teamA.players[0]?.name.split(' ')[0] || 'Jugador'}</span>
                  </div>
                  <div className="flex items-end gap-2 mb-2">
                      <span className="text-5xl font-black text-white italic drop-shadow-md tracking-tighter">
                          104
                      </span>
                      <span className="text-emerald-400 font-bold mb-1">km/h</span>
                  </div>
                  {/* Dial / Bar Graph */}
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-3 relative">
                      <div className="absolute top-0 left-0 h-full w-[85%] bg-gradient-to-r from-emerald-500 to-yellow-400"></div>
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] font-bold text-slate-500">
                      <span>0</span>
                      <span>MAX 120+</span>
                  </div>
              </div>
          </div>
      )}

      {activeTvSettings?.showSetStatsExt && (
          <div className="fixed inset-0 z-40 flex flex-col pointer-events-none items-center justify-center p-4 bg-transparent animate-in zoom-in duration-500">
             <div className="relative w-full max-w-4xl bg-gradient-to-b from-[#1a1440]/95 to-[#0f0b29]/95 border-y-4 border-[#4C8BFF] rounded overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-md">
                 <div className="flex flex-col pt-6 pb-2 relative">
                     <div className="absolute top-2 left-4 text-[#827DFF] font-black italic text-xl opacity-50 tracking-tighter">VOLLEYTV</div>
                     <div className="text-center w-full text-white/70 font-black tracking-[0.3em] text-sm mb-4">SET STATISTICS</div>
                     {/* Teams and Score Header */}
                     <div className="flex items-center justify-between px-16 mb-8">
                         <div className="flex items-center gap-6">
                            <div className="w-16 h-10 bg-white border-2 border-white/20 rounded shadow overflow-hidden flex items-center justify-center">
                                {teamA.logoUrl ? <img src={teamA.logoUrl} className="w-full h-full object-cover"/> : <div className="text-black font-black">{teamA.name.substring(0,3).toUpperCase()}</div>}
                            </div>
                            <span className="text-6xl font-black text-white italic tracking-tighter drop-shadow-lg">{teamA.name.substring(0,3).toUpperCase()}</span>
                         </div>
                         <div className="text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                             {match.sets.filter(s=>s.scoreA > s.scoreB).length} - {match.sets.filter(s=>s.scoreB > s.scoreA).length}
                         </div>
                         <div className="flex items-center gap-6 text-right flex-row-reverse">
                            <div className="w-16 h-10 bg-white border-2 border-white/20 rounded shadow overflow-hidden flex items-center justify-center">
                                {teamB.logoUrl ? <img src={teamB.logoUrl} className="w-full h-full object-cover"/> : <div className="text-black font-black">{teamB.name.substring(0,3).toUpperCase()}</div>}
                            </div>
                            <span className="text-6xl font-black text-white italic tracking-tighter drop-shadow-lg">{teamB.name.substring(0,3).toUpperCase()}</span>
                         </div>
                     </div>
                     {/* Stats Rows */}
                     <div className="flex flex-col gap-1.5 px-4 pb-6">
                         {/* SET HEADER */}
                         <div className="flex justify-between items-center text-xs font-black text-white/50 px-[20%] mb-1">
                             <span>SET {match.currentSet}</span>
                             <span>SET {match.currentSet}</span>
                         </div>
                         {(() => {
                             // Calculation of current set stats
                             const currSet = match.sets[match.currentSet - 1] || { history: [] };
                             const setHistory = currSet.history || [];
                             const actsA = setHistory.filter(h=>h.teamId===teamA.id);
                             const actsB = setHistory.filter(h=>h.teamId===teamB.id);

                             const ptsA = match.scoreA;
                             const ptsB = match.scoreB;
                             
                             const attA = actsA.filter(h=>h.type==='attack').length;
                             const attB = actsB.filter(h=>h.type==='attack').length;

                             const blkA = actsA.filter(h=>h.type==='block').length;
                             const blkB = actsB.filter(h=>h.type==='block').length;

                             const srvA = actsA.filter(h=>h.type==='ace').length;
                             const srvB = actsB.filter(h=>h.type==='ace').length;

                             const errOPA = actsB.filter(h=>h.type==='opponent_error').length; // points for A due to B's error
                             const errOPB = actsA.filter(h=>h.type==='opponent_error').length; // points for B due to A's error

                             const rows = [
                                 { label: 'POINTS', l: ptsA, r: ptsB, max: Math.max(ptsA, ptsB) || 25 },
                                 { label: 'ATTACKS', l: attA, r: attB, max: Math.max(attA, attB) || 15 },
                                 { label: 'BLOCKS', l: blkA, r: blkB, max: Math.max(blkA, blkB) || 5 },
                                 { label: 'SERVES', l: srvA, r: srvB, max: Math.max(srvA, srvB) || 5 },
                                 { label: 'OPPONENT ERRORS', l: errOPA, r: errOPB, max: Math.max(errOPA, errOPB) || 10 },
                             ];

                             return rows.map((r, idx) => {
                                 const total = r.l + r.r;
                                 const pctL = total > 0 ? Math.round((r.l / total) * 100) : 0;
                                 const pctR = total > 0 ? Math.round((r.r / total) * 100) : 0;
                                 
                                 return (
                                 <div key={idx} className="flex justify-center items-center w-full">
                                     <div className="flex-1 flex justify-end items-center px-4 relative h-8">
                                         <div className="absolute top-1/2 -translate-y-1/2 right-0 h-4 bg-gradient-to-r from-transparent to-blue-600 z-0" style={{ width: `${(r.l / Math.max(1, r.max)) * 100}%`}}></div>
                                         <span className="relative z-10 text-white font-black text-lg bg-[#302766] px-3 py-0.5 rounded shadow-lg flex items-center gap-2">
                                            {r.l} <span className="text-[10px] text-blue-300 opacity-70">({pctL}%)</span>
                                         </span>
                                     </div>
                                     <div className="w-1/4 text-center text-white/80 font-black tracking-widest text-sm bg-black/20 py-1">
                                         {r.label}
                                     </div>
                                     <div className="flex-1 flex justify-start items-center px-4 relative h-8">
                                         <div className="absolute top-1/2 -translate-y-1/2 left-0 h-4 bg-gradient-to-l from-transparent to-red-600 z-0" style={{ width: `${(r.r / Math.max(1, r.max)) * 100}%`}}></div>
                                         <span className="relative z-10 text-white font-black text-lg bg-[#66273c] px-3 py-0.5 rounded shadow-lg flex items-center gap-2 flex-row-reverse">
                                            {r.r} <span className="text-[10px] text-red-300 opacity-70">({pctR}%)</span>
                                         </span>
                                     </div>
                                 </div>
                             )});
                         })()}
                     </div>
                 </div>
             </div>
          </div>
      )}

      {/* WIN PREDICTION */}
      {activeTvSettings?.showWinPrediction && (
          <div className="absolute bottom-8 right-8 z-40 flex flex-col pointer-events-none items-center justify-center bg-transparent animate-in slide-in-from-right duration-500 w-[300px]">
              <div className="relative w-full bg-[#0f0b29]/95 border-l-[4px] border-[#4C8BFF] rounded-lg overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.8)] backdrop-blur-md">
                 <div className="flex flex-col relative w-full pt-3">
                     <div className="text-center w-full text-white font-bold tracking-[0.2em] text-xs mb-2">WIN PREDICTION</div>
                     <div className="flex px-4 h-24 relative w-full border-t border-b border-white/20 items-center">
                         {/* X Axis */}
                         <div className="absolute left-4 right-16 bottom-2 flex justify-between items-end px-2 text-white/50 font-bold text-[8px]">
                             {match.sets.map((_, idx) => <div key={idx}>S{idx+1}</div>)}
                             <div>S{match.sets.length + 1}</div>
                         </div>

                         {/* Simplified Fake Chart Lines */}
                         {(() => {
                             return (
                                 <div className="absolute inset-0 right-16 left-4 top-2 bottom-6 flex items-center">
                                    <svg className="w-full h-full" overflow="visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <polyline 
                                            points="0,30 33,40 66,35 100,50" 
                                            fill="none" stroke="#22c55e" strokeWidth="3" 
                                        />
                                        <polyline 
                                            points="0,70 33,60 66,65 100,50" 
                                            fill="none" stroke="#ef4444" strokeWidth="3" 
                                        />
                                        <circle cx="100" cy="50" r="4" fill="#22c55e" />
                                        <circle cx="100" cy="50" r="4" fill="#ef4444" />
                                    </svg>
                                 </div>
                             )
                         })()}

                         {/* Right Text */}
                         {(() => {
                             const diffPoints = match.scoreA - match.scoreB;
                             const baseA = 50 + diffPoints * 2;
                             const probA = Math.max(10, Math.min(90, baseA));
                             const probB = 100 - probA;
                             
                             const winnerProb = Math.max(probA, probB);
                             const loserProb = Math.min(probA, probB);
                             const winnerName = probA >= probB ? teamA.name.substring(0,3).toUpperCase() : teamB.name.substring(0,3).toUpperCase();
                             return (
                                 <div className="absolute right-2 top-0 bottom-0 py-2 flex flex-col justify-between font-black text-white text-lg">
                                     <div className="text-right leading-none mt-1">
                                         {winnerProb}<span className="text-[10px]">%</span><br/>
                                         <span className="text-[8px] font-bold opacity-80">{winnerName}</span>
                                     </div>
                                     <div className="text-right leading-none mb-1">
                                         {loserProb}<span className="text-[10px]">%</span>
                                     </div>
                                 </div>
                             )
                         })()}
                     </div>

                     <div className="flex justify-between w-full font-black text-lg italic tracking-tighter pt-2 pb-1">
                         <div className="flex-1 text-center bg-gradient-to-r from-transparent to-red-500/20 text-white drop-shadow-md">
                             {teamA.name.substring(0,3).toUpperCase()}
                         </div>
                         <div className="flex-1 text-center bg-gradient-to-l from-transparent to-emerald-500/20 text-white drop-shadow-md">
                             {teamB.name.substring(0,3).toUpperCase()}
                         </div>
                     </div>
                     <div className="w-full flex h-1">
                         <div className="flex-1 bg-red-400"></div>
                         <div className="flex-1 bg-emerald-500"></div>
                     </div>
                 </div>
              </div>
          </div>
      )}

      {/* RECEIVER ACCURACY / SERVE ERRORS */}
      {activeTvSettings?.showReceiverAccuracy && (
          <div className="fixed inset-0 z-40 flex flex-col pointer-events-none items-center justify-end pb-32 animate-in slide-in-from-bottom fade-in duration-700">
              <div className="relative border-b-4 border-slate-300 w-full max-w-5xl h-80 bg-[#b29f8a] border-4 border-white shadow-[0_20px_50px_rgba(0,0,0,0.8)] perspective-1000 transform rotate-x-[20deg] flex flex-col items-center overflow-hidden">
                 {/* Court lines */}
                 <div className="absolute inset-4 border-2 border-white"></div>
                 <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white z-10 shadow-[0_5px_15px_rgba(0,0,0,0.5)]"></div>
                 <div className="absolute inset-x-4 top-[33%] w-[calc(100%-2rem)] h-1 bg-white/50"></div>
                 <div className="absolute inset-x-4 top-[66%] w-[calc(100%-2rem)] h-1 bg-white/50"></div>
                 <div className="absolute text-[8rem] font-black text-rose-500/20 italic tracking-tighter top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">VOLLEYTV</div>
                 
                 {/* 3D Balls (Fake positions for representation, as we don't track XY currently) */}
                 <div className="absolute inset-0">
                     <div className="absolute top-[20%] left-[30%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[25%] left-[40%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[35%] left-[55%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[55%] left-[65%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[50%] left-[45%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[60%] left-[50%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[65%] left-[35%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[80%] left-[45%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                     <div className="absolute top-[40%] left-[80%] w-3 h-3 bg-yellow-400 rounded-full shadow-lg border border-yellow-600"></div>
                 </div>

                 {/* Zone Overlays */}
                 <div className="absolute top-[10%] right-10 bg-[#302766] text-white font-bold px-4 py-1 flex items-center gap-2 border border-blue-400/50 shadow-xl">
                     <span className="text-sm">Outer Zone</span> <span className="text-xl font-black">15%</span>
                 </div>
                 <div className="absolute top-[35%] right-10 bg-[#302766] text-white font-bold px-4 py-1 flex items-center gap-2 border border-blue-400/50 shadow-xl">
                     <span className="text-sm">Mid Zone</span> <span className="text-xl font-black">38%</span>
                 </div>
                 <div className="absolute top-[60%] right-10 bg-[#302766] text-white font-bold px-4 py-1 flex items-center gap-2 border border-blue-400/50 shadow-xl">
                     <span className="text-sm">Target Zone</span> <span className="text-xl font-black">47%</span>
                 </div>
              </div>

              {/* Bottom Label Bar */}
              <div className="relative mt-2 flex bg-indigo-900 shadow-2xl h-12 w-full max-w-4xl text-white font-black items-center overflow-hidden">
                   <div className="flex bg-[#302766] h-full items-center px-6 gap-4">
                       {teamA.logoUrl ? <img src={teamA.logoUrl} className="h-8"/> : <span className="text-2xl">{teamA.name.substring(0,3).toUpperCase()}</span>}
                   </div>
                   <div className="flex-1 text-center bg-transparent items-center justify-center flex flex-col">
                       <span className="text-sm tracking-widest leading-none mt-1">RECEIVER ACCURACY</span>
                       <span className="text-[10px] text-white/50 tracking-widest leading-none mt-1">SECOND CONTACT</span>
                   </div>
                   <div className="bg-pink-600 h-full w-20 flex items-center justify-center flex-col text-sm tracking-widest leading-none">
                       SET {match.currentSet}
                   </div>
              </div>
          </div>
      )}

      {/* --- MATCH STATISTICS OVERLAY --- */}
      {(activeTvSettings?.showMatchStatsExt || (matchEnded && winner)) ? (
          <div className="relative z-40 w-full max-w-4xl mx-auto mb-10 animate-in slide-in-from-bottom-10 fade-in duration-700 mt-20 md:mt-0">
             <div className="bg-gradient-to-b from-slate-900/95 to-blue-950/95 text-white rounded-xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/20 backdrop-blur-xl m-4">
                 <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-4 text-center border-b border-white/10">
                     <h2 className="text-2xl font-black uppercase tracking-widest italic">{matchEnded ? 'RESULTADO FINAL' : 'ESTADÍSTICAS DEL PARTIDO'}</h2>
                 </div>
                 
                 <div className="p-8 flex flex-col items-center">
                     {(matchEnded && winner) && <div className="text-sm font-bold text-blue-200 uppercase tracking-widest mb-4">Ganador del Partido</div>}
                     <div className={`flex items-center gap-6 mb-8 transform scale-125 transition-all`}>
                         {(matchEnded && winner) ? (
                             <>
                                {winner.logoUrl && <img src={winner.logoUrl} className="w-20 h-20 object-contain bg-white rounded-full p-2 shadow-lg" alt="" />}
                                <div className="text-5xl font-black text-white italic drop-shadow-lg uppercase">{winner.name}</div>
                             </>
                         ) : (
                             <>
                                {teamA.logoUrl ? <img src={teamA.logoUrl} className="w-16 h-16 object-contain bg-white rounded-full p-2 shadow-lg" /> : <div className="text-3xl font-black">{teamA.name.substring(0,3).toUpperCase()}</div>}
                                <div className="text-4xl font-black text-white italic drop-shadow-lg uppercase">{teamA.name}</div>
                                <div className="text-4xl text-white/50 px-4">VS</div>
                                <div className="text-4xl font-black text-white italic drop-shadow-lg uppercase">{teamB.name}</div>
                                {teamB.logoUrl ? <img src={teamB.logoUrl} className="w-16 h-16 object-contain bg-white rounded-full p-2 shadow-lg" /> : <div className="text-3xl font-black">{teamB.name.substring(0,3).toUpperCase()}</div>}
                             </>
                         )}
                     </div>
                     
                     <div className="flex gap-2 mb-8">
                         {sets.map((s, i) => {
                             const isSetPlayed = s.scoreA > 0 || s.scoreB > 0 || (i <= match.currentSet - 1);
                             if (!isSetPlayed) return null;
                             return (
                                 <div key={i} className="flex flex-col items-center bg-black/40 px-6 py-4 rounded-xl border-2 border-white/10 shadow-lg">
                                     <div className="text-xs text-gray-400 uppercase font-bold mb-2">Set {i+1}</div>
                                     <div className={`text-4xl font-mono font-black ${matchEnded ? (winner?.id === teamA.id ? (s.scoreA > s.scoreB ? 'text-yellow-400' : 'text-white') : (s.scoreB > s.scoreA ? 'text-yellow-400' : 'text-white')) : 'text-white'}`}>
                                         <span className={s.scoreA > s.scoreB ? 'text-yellow-400 drop-shadow-md' : 'text-white'}>{s.scoreA}</span>
                                         <span className="text-white/30 px-2">-</span>
                                         <span className={s.scoreB > s.scoreA ? 'text-yellow-400 drop-shadow-md' : 'text-white'}>{s.scoreB}</span>
                                     </div>
                                 </div>
                             );
                         })}
                     </div>
                 </div>
             </div>
          </div>
      ) : (
          /* --- SCOREBOARD (RESPONSIVE VERTICAL/HORIZONTAL) --- */
          renderScoreboard && !isPreMatch && !activeShowRotation && (
            <div className={`relative z-10 transition-all duration-300
                ${isVertical 
                    ? 'absolute top-0 left-0 h-full w-32 md:w-40 flex items-center justify-center pointer-events-none' 
                    : 'absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 w-[96%] max-w-[1200px] px-4 md:px-0 pointer-events-none scale-90 md:scale-95 flex justify-center origin-bottom'
                }
            `}
            style={(boardAnim === 'in' || boardAnim === 'out') ? {
                animation: boardAnim === 'in' 
                    ? 'drawBoardIn 0.8s cubic-bezier(0.8, 0, 0.2, 1) forwards' 
                    : 'drawBoardOut 0.8s cubic-bezier(0.8, 0, 0.2, 1) forwards'
            } : {}}
            >
                
                <div className={`bg-transparent rounded-none overflow-visible flex flex-col items-center pointer-events-auto shrink-0 relative
                    ${isVertical 
                        ? 'rotate-90 origin-center w-[50vh] max-w-none h-10 md:h-12 shadow-[0_15px_30px_rgba(0,0,0,0.8)]' 
                        : 'w-full h-10 md:h-12 shadow-[0_15px_30px_rgba(0,0,0,0.8)]'
                    }
                `}>
                    {/* Top Tab for Tournament Name */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 bg-[#0f172a] rounded-t-xl px-4 md:px-8 py-1 md:py-2 flex items-center gap-2 text-white font-black text-[10px] md:text-sm tracking-[0.2em] shadow-lg">
                       <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                       {tournament?.name || "LIGA EXCLUSIVA"}
                    </div>
                    
                    {/* Set Point / Match Point Banner */}
                    {pointBanner && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-6 z-50 pointer-events-none flex flex-col items-center justify-center animate-in slide-in-from-bottom-5 duration-500">
                             <div className="bg-gradient-to-t from-black/95 to-black/70 backdrop-blur-md px-12 md:px-24 py-3 md:py-5 rounded-t-[1.5rem] border-t-4 border-x border-white/20 shadow-[0_-20px_50px_rgba(0,0,0,0.6)]" style={{ borderTopColor: pointBanner.color }}>
                                 <h1 className="text-4xl md:text-6xl font-black text-white italic uppercase tracking-[0.15em] drop-shadow-lg" style={{ color: pointBanner.color }}>
                                     {pointBanner.text}
                                 </h1>
                                 <div className="mt-1 flex justify-center">
                                     <div className="text-white/90 font-bold uppercase tracking-[0.2em] text-xs md:text-sm bg-white/10 px-4 py-1 rounded-full border border-white/10">
                                         {pointBanner.text === 'MATCH POINT' ? 'PUNTO DE PARTIDO' : 'PUNTO DE SET'}
                                     </div>
                                 </div>
                             </div>
                        </div>
                    )}

                    {/* Left Attachment (Team A Stats) */}
                    {(activeTvSettings?.showTeamStats === teamA.id || activeTvSettings?.showPlayerStats || (activeTvSettings?.featuredPlayerMode === 'stats' && teamA.players.some(p => p.id === activeTvSettings?.featuredPlayerId))) && !isVertical && (
                        <div className="absolute top-1/2 -translate-y-1/2 right-[100%] pr-2 h-[80%] flex animate-in slide-in-from-right fade-in pointer-events-none">
                             <div className="h-full bg-gradient-to-r from-transparent to-[#181d2e] rounded-l-full border-y border-l border-white/10 shadow-2xl flex items-center pr-4 pl-8 gap-3">
                                  <div className="flex flex-col items-end">
                                      <span className="text-[7px] md:text-[9px] font-black text-white/50 uppercase tracking-[0.2em] leading-none">
                                          {activeTvSettings?.showTeamStats === teamA.id ? 'Ataque Efectividad' : (activeTvSettings?.featuredPlayerMode === 'stats' ? 'Destacado' : 'Top Anotador')}
                                      </span>
                                      <span className="text-[10px] md:text-sm font-black text-[#827DFF] uppercase tracking-widest leading-none mt-1">
                                          {activeTvSettings?.showTeamStats === teamA.id ? 'Equipo A' : (()=>{
                                              if (activeTvSettings?.featuredPlayerMode === 'stats') {
                                                  const fp = teamA.players.find(p=>p.id===activeTvSettings?.featuredPlayerId);
                                                  return fp ? `#${fp.number} ${fp.name.split(' ')[0]}` : '';
                                              }
                                              let bestPlayer = 'NINGUNO'; let maxPts = 0;
                                              const scores: Record<string, number> = {};
                                              match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamA.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                  if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                              });
                                              Object.entries(scores).forEach(([pId, pts]) => {
                                                  if(pts > maxPts) { maxPts=pts; bestPlayer=teamA.players.find(p=>p.id===pId)?.name.split(' ')[0]||'Jugador'; }
                                              });
                                              return maxPts > 0 ? bestPlayer : 'N/A';
                                          })()}
                                      </span>
                                  </div>
                                  <div className="relative w-8 h-8 md:w-12 md:h-12 flex items-center justify-center">
                                       <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                          <path stroke="rgba(255,255,255,0.1)" strokeWidth="4" fill="none" strokeDasharray="50, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                          <path stroke="#827DFF" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(()=>{
                                              if(activeTvSettings?.showPlayerStats || activeTvSettings?.featuredPlayerMode === 'stats') {
                                                  let maxPts = 0;
                                                  const scores: Record<string, number> = {};
                                                  match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamA.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                      if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                                  });
                                                  if (activeTvSettings?.featuredPlayerMode === 'stats' && activeTvSettings.featuredPlayerId) {
                                                      return Math.min(50, ((scores[activeTvSettings.featuredPlayerId] || 0)/10)*50);
                                                  }
                                                  Object.values(scores).forEach(pts => { if(pts>maxPts) maxPts=pts; });
                                                  return Math.min(50, (maxPts/10)*50);
                                              } else {
                                                  const acts = match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamA.id && h.type==='attack');
                                                  const succ = acts.length; 
                                                  const err = match.sets.flatMap(s=>s.history).filter(h=>h.teamId!==teamA.id && h.type==='opponent_error').length;
                                                  const tot = succ + err;
                                                  return tot > 0 ? (succ/tot)*50 : 0;
                                              }
                                          })()}, 100`} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" className="transition-all duration-1000 ease-out"/>
                                       </svg>
                                       <span className="text-white font-black text-[10px] md:text-sm">{(()=>{
                                            if(activeTvSettings?.showPlayerStats || activeTvSettings?.featuredPlayerMode === 'stats') {
                                                let maxPts = 0;
                                                const scores: Record<string, number> = {};
                                                match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamA.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                    if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                                });
                                                if (activeTvSettings?.featuredPlayerMode === 'stats' && activeTvSettings.featuredPlayerId) {
                                                    const fpPts = scores[activeTvSettings.featuredPlayerId] || 0;
                                                    return fpPts + (fpPts===1?'pt':'pts');
                                                }
                                                Object.values(scores).forEach(pts => { if(pts>maxPts) maxPts=pts; });
                                                return maxPts + (maxPts===1?'pt':'pts');
                                            } else {
                                                const acts = match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamA.id && h.type==='attack');
                                                const succ = acts.length; 
                                                const err = match.sets.flatMap(s=>s.history).filter(h=>h.teamId!==teamA.id && h.type==='opponent_error').length;
                                                const tot = succ + err;
                                                return tot > 0 ? Math.round((succ/tot)*100)+'%' : '0%';
                                            }
                                       })()}</span>
                                  </div>
                             </div>
                        </div>
                    )}

                    {/* Right Attachment (Team B Stats) */}
                    {(activeTvSettings?.showTeamStats === teamB.id || activeTvSettings?.showPlayerStats || (activeTvSettings?.featuredPlayerMode === 'stats' && teamB.players.some(p => p.id === activeTvSettings?.featuredPlayerId))) && !isVertical && (
                        <div className="absolute top-1/2 -translate-y-1/2 left-[100%] pl-2 h-[80%] flex animate-in slide-in-from-left fade-in pointer-events-none">
                             <div className="h-full bg-gradient-to-l from-transparent to-[#181d2e] rounded-r-full border-y border-r border-white/10 shadow-2xl flex items-center pl-4 pr-8 gap-3">
                                  <div className="relative w-8 h-8 md:w-12 md:h-12 flex items-center justify-center">
                                       <svg className="absolute inset-0 w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                          <path stroke="rgba(255,255,255,0.1)" strokeWidth="4" fill="none" strokeDasharray="50, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                                          <path stroke="#4C8BFF" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(()=>{
                                              if(activeTvSettings?.showPlayerStats || activeTvSettings?.featuredPlayerMode === 'stats') {
                                                  let maxPts = 0;
                                                  const scores: Record<string, number> = {};
                                                  match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamB.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                      if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                                  });
                                                  if (activeTvSettings?.featuredPlayerMode === 'stats' && activeTvSettings.featuredPlayerId) {
                                                      return Math.min(50, ((scores[activeTvSettings.featuredPlayerId] || 0)/10)*50);
                                                  }
                                                  Object.values(scores).forEach(pts => { if(pts>maxPts) maxPts=pts; });
                                                  return Math.min(50, (maxPts/10)*50);
                                              } else {
                                                  const acts = match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamB.id && h.type==='attack');
                                                  const succ = acts.length; 
                                                  const err = match.sets.flatMap(s=>s.history).filter(h=>h.teamId!==teamB.id && h.type==='opponent_error').length;
                                                  const tot = succ + err;
                                                  return tot > 0 ? (succ/tot)*50 : 0;
                                              }
                                          })()}, 100`} fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" className="transition-all duration-1000 ease-out"/>
                                       </svg>
                                       <span className="text-white font-black text-[10px] md:text-sm">{(()=>{
                                            if(activeTvSettings?.showPlayerStats || activeTvSettings?.featuredPlayerMode === 'stats') {
                                                let maxPts = 0;
                                                const scores: Record<string, number> = {};
                                                match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamB.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                    if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                                });
                                                if (activeTvSettings?.featuredPlayerMode === 'stats' && activeTvSettings.featuredPlayerId) {
                                                    const fpPts = scores[activeTvSettings.featuredPlayerId] || 0;
                                                    return fpPts + (fpPts===1?'pt':'pts');
                                                }
                                                Object.values(scores).forEach(pts => { if(pts>maxPts) maxPts=pts; });
                                                return maxPts + (maxPts===1?'pt':'pts');
                                            } else {
                                                const acts = match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamB.id && h.type==='attack');
                                                const succ = acts.length; 
                                                const err = match.sets.flatMap(s=>s.history).filter(h=>h.teamId!==teamB.id && h.type==='opponent_error').length;
                                                const tot = succ + err;
                                                return tot > 0 ? Math.round((succ/tot)*100)+'%' : '0%';
                                            }
                                       })()}</span>
                                  </div>
                                  <div className="flex flex-col items-start">
                                      <span className="text-[7px] md:text-[9px] font-black text-white/50 uppercase tracking-[0.2em] leading-none">
                                          {activeTvSettings?.showTeamStats === teamB.id ? 'Ataque Efectividad' : (activeTvSettings?.featuredPlayerMode === 'stats' ? 'Destacado' : 'Top Anotador')}
                                      </span>
                                      <span className="text-[10px] md:text-sm font-black text-[#4C8BFF] uppercase tracking-widest leading-none mt-1">
                                          {activeTvSettings?.showTeamStats === teamB.id ? 'Equipo B' : (()=>{
                                              if (activeTvSettings?.featuredPlayerMode === 'stats') {
                                                  const fp = teamB.players.find(p=>p.id===activeTvSettings?.featuredPlayerId);
                                                  return fp ? `#${fp.number} ${fp.name.split(' ')[0]}` : '';
                                              }
                                              let bestPlayer = 'NINGUNO'; let maxPts = 0;
                                              const scores: Record<string, number> = {};
                                              match.sets.flatMap(s=>s.history).filter(h=>h.teamId===teamB.id && ['attack','block','ace'].includes(h.type)).forEach(h => {
                                                  if(h.playerId) { scores[h.playerId] = (scores[h.playerId] || 0) + 1; }
                                              });
                                              Object.entries(scores).forEach(([pId, pts]) => {
                                                  if(pts > maxPts) { maxPts=pts; bestPlayer=teamB.players.find(p=>p.id===pId)?.name.split(' ')[0]||'Jugador'; }
                                              });
                                              return maxPts > 0 ? bestPlayer : 'N/A';
                                          })()}
                                      </span>
                                  </div>
                             </div>
                        </div>
                    )}

                    <div className="w-full h-full flex rounded shadow-2xl overflow-hidden font-sans">
                        
                        {/* Team A/Left Section */}
                        <div className="flex-1 flex items-center justify-between pl-2 md:pl-4 pr-0 bg-[#252a3b]" style={{ borderLeft: `4px solid ${swapSides ? '#4C8BFF' : '#827DFF'}` }}>
                            <div className="flex flex-row items-center flex-1">
                                {/* Logo */}
                                <div className="bg-transparent rounded relative flex-shrink-0 flex items-center justify-center w-6 h-6 md:w-10 md:h-10 mr-2">
                                    {(swapSides ? teamB : teamA).logoUrl ? <img src={(swapSides ? teamB : teamA).logoUrl} className="w-full h-full object-contain" /> : <div className="w-full h-full bg-black/40 rounded flex items-center justify-center text-slate-400 font-bold text-xs">{(swapSides ? teamB : teamA).name[0]}</div>}
                                    {(swapSides ? match.servingTeamId === teamB.id : match.servingTeamId === teamA.id) && <div className="absolute -top-1 -right-1 text-[8px] md:text-xs bg-white rounded-full leading-none shadow-sm border border-slate-200">🏐</div>}
                                </div>
                                {/* Name */}
                                <div className="flex-1 min-w-0 pr-2 md:pr-4">
                                    <h2 className={`text-white font-black uppercase tracking-widest truncate ${isVertical ? 'text-[9px] md:text-lg' : 'text-[10px] md:text-xl'}`}>{(swapSides ? teamB : teamA).name}</h2>
                                    <div className="flex gap-1 mt-0.5">
                                        {Array.from({length: requiredWins}).map((_, i) => (
                                            <div key={i} className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${i < (swapSides ? winsB : winsA) ? 'bg-white shadow-[0_0_5px_rgba(255,255,255,0.8)]' : 'bg-white/10'}`}></div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {/* Score */}
                            <div className="bg-[#181d2e] h-full flex items-center justify-center px-3 md:px-6 border-l border-white/5 border-r border-[#0f172a]">
                                <span className={`font-black tabular-nums tracking-tighter leading-none ${isVertical ? 'text-xl md:text-4xl' : 'text-2xl md:text-[2.5rem]'}`} style={{ color: swapSides ? '#4C8BFF' : '#827DFF' }}>
                                    {swapSides ? match.scoreB : match.scoreA}
                                </span>
                            </div>
                        </div>

                        {/* Center Info - Tournament Logo */}
                        <div className="flex flex-col items-center justify-center z-10 relative flex-shrink-0 bg-[#0f172a] w-14 md:w-28 h-full p-2 border-x border-black/50">
                            {tournament?.logoUrl ? (
                                <img src={tournament.logoUrl} className="h-full w-full object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" />
                            ) : (
                                <div className="text-[9px] md:text-[10px] text-white/50 font-bold uppercase tracking-widest text-center leading-tight">
                                    VS
                                </div>
                            )}
                        </div>

                        {/* Team B/Right Section */}
                        <div className="flex-1 flex items-center justify-between pr-2 md:pr-4 pl-0 bg-[#2b2a3b] flex-row-reverse" style={{ borderRight: `4px solid ${swapSides ? '#827DFF' : '#4C8BFF'}` }}>
                            <div className="flex flex-row-reverse items-center flex-1">
                                {/* Logo */}
                                <div className="bg-transparent rounded relative flex-shrink-0 flex items-center justify-center w-6 h-6 md:w-10 md:h-10 ml-2">
                                    {(swapSides ? teamA : teamB).logoUrl ? <img src={(swapSides ? teamA : teamB).logoUrl} className="w-full h-full object-contain" /> : <div className="w-full h-full bg-black/40 rounded flex items-center justify-center text-slate-400 font-bold text-xs">{(swapSides ? teamA : teamB).name[0]}</div>}
                                    {(swapSides ? match.servingTeamId === teamA.id : match.servingTeamId === teamB.id) && <div className="absolute -top-1 -left-1 text-[8px] md:text-xs bg-white rounded-full leading-none shadow-sm border border-slate-200">🏐</div>}
                                </div>
                                {/* Name */}
                                <div className="flex-1 min-w-0 pl-2 md:pl-4 flex flex-col items-end">
                                    <h2 className={`text-white font-black uppercase tracking-widest truncate ${isVertical ? 'text-[9px] md:text-lg' : 'text-[10px] md:text-xl'}`}>{(swapSides ? teamA : teamB).name}</h2>
                                    <div className="flex gap-1 mt-0.5 justify-end">
                                        {Array.from({length: requiredWins}).map((_, i) => (
                                            <div key={i} className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${i < (swapSides ? winsA : winsB) ? 'bg-white shadow-[0_0_5px_rgba(255,255,255,0.8)]' : 'bg-white/10'}`}></div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {/* Score */}
                            <div className="bg-[#181d2e] h-full flex items-center justify-center px-3 md:px-6 border-r border-white/5 border-l border-[#0f172a]">
                                <span className={`font-black tabular-nums tracking-tighter leading-none ${isVertical ? 'text-xl md:text-4xl' : 'text-2xl md:text-[2.5rem]'}`} style={{ color: swapSides ? '#827DFF' : '#4C8BFF' }}>
                                    {swapSides ? match.scoreA : match.scoreB}
                                </span>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
          )
      )}

      {/* --- CONTROLS OVERLAY --- */}
      {showControls && isAdmin && onPoint && (
          <div className="absolute inset-x-0 bottom-0 z-50 bg-black/80 backdrop-blur-xl border-t border-white/20 p-4 animate-in slide-in-from-bottom-10 max-h-[60vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-black text-white uppercase italic">Controles de Partido</h3>
                  <button onClick={() => setShowControls(false)} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded font-bold uppercase text-xs">Cerrar</button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Team A Controls */}
                  <ScoreControl 
                      role={currentUser?.role as any}
                      linkedTeamId={currentUser?.linkedTeamId}
                      onPoint={onPoint}
                      onSubtractPoint={onSubtractPoint}
                      onRequestTimeout={onRequestTimeout!}
                      onRequestSub={onRequestSub!}
                      onModifyRotation={onModifyRotation!}
                      onSetServe={onSetServe!}
                      teamId={teamA.id}
                      teamName={teamA.name}
                      players={match.rotationA}
                      disabled={match.status === 'finished'}
                      timeoutsUsed={match.timeoutsA}
                      subsUsed={match.substitutionsA}
                      isServing={match.servingTeamId === teamA.id}
                  />

                  {/* Team B Controls */}
                  <ScoreControl 
                      role={currentUser?.role as any}
                      linkedTeamId={currentUser?.linkedTeamId}
                      onPoint={onPoint}
                      onSubtractPoint={onSubtractPoint}
                      onRequestTimeout={onRequestTimeout!}
                      onRequestSub={onRequestSub!}
                      onModifyRotation={onModifyRotation!}
                      onSetServe={onSetServe!}
                      teamId={teamB.id}
                      teamName={teamB.name}
                      players={match.rotationB}
                      disabled={match.status === 'finished'}
                      timeoutsUsed={match.timeoutsB}
                      subsUsed={match.substitutionsB}
                      isServing={match.servingTeamId === teamB.id}
                  />
              </div>
          </div>
      )}

    </div>
  );
};

export default TVOverlay;
