import React from 'react';
import { Player, Team } from '../types';
import { Court } from './Court';

interface RotationViewProps {
  teamA: Team;
  teamB: Team;
  rotationA: (Player | null)[];
  rotationB: (Player | null)[];
  isVertical: boolean;
}

export const RotationView: React.FC<RotationViewProps> = ({ teamA, teamB, rotationA, rotationB, isVertical }) => {
  return (
    <div className={`absolute inset-0 z-40 flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 pointer-events-none 
        ${isVertical ? 'rotate-90 origin-center' : ''}
    `}>
        <div className="absolute top-8 text-center animate-in slide-in-from-top-10 duration-500">
            <h2 className="text-3xl md:text-5xl font-black text-white italic tracking-[0.3em] drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">FORMACIÓN</h2>
        </div>

        <div className={`flex gap-6 pointer-events-auto items-center justify-center p-8 bg-[#1a1c29]/90 border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)]
            ${isVertical 
                ? 'flex-row w-[85vh] h-[90vw] scale-90' // Rotated: Width becomes Height (85% screen height), Height becomes Width (90% screen width)
                : 'flex-col md:flex-row w-full max-w-5xl scale-75 md:scale-95'
            }
        `}>
            {/* Team A Court */}
            <div className={`flex-1 ${isVertical ? 'h-full' : 'w-full'}`}>
                <Court 
                    players={rotationA} 
                    serving={false} 
                    teamName={teamA.name} 
                    variant="default"
                    isVertical={false} // Always horizontal inside the view (rotated or not)
                />
            </div>

            {/* Team B Court */}
            <div className={`flex-1 ${isVertical ? 'h-full' : 'w-full'}`}>
                <Court 
                    players={rotationB} 
                    serving={false} 
                    teamName={teamB.name} 
                    variant="default"
                    isVertical={false} // Always horizontal inside the view
                />
            </div>
        </div>
    </div>
  );
};
