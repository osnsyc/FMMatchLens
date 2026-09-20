namespace FMMatchLens.Plugin.Memory;

internal static class Offsets
{
    public static class GameMatch
    {
        public const int CompetitionId = 0x684;
        public const int CompetitionPrimaryColour = 0x68C;
        public const int CompetitionSecondaryColour = 0x690;
        public const int CompetitionTertiaryColour = 0x694;
        public const int MatchPlayersCount = 0x13A20;
        public const int FirstMatchPlayer = 0x13A28;
        public const int MomentumEventSource = 0x139F0;
        public const int WaitingReceiver = 0x13D10;
        public const int HomeTeam = 0x14100;
        public const int AwayTeam = 0x14108;
        public const int StadiumColourObject = 0x14178;
        public const int PreviousBallHolder = 0x14118;
        public const int CurrentBallHolder = 0x14120;
        public const int Referee = 0x14170;
        public const int PossessionTeam = 0x141C0;
        public const int DisplayTick = 0x141EC;
        public const int AssistantRefereeOne = 0x141D0;
        public const int AssistantRefereeTwo = 0x141D8;
        public const int FourthOfficialOne = 0x141E0;
        public const int FourthOfficialTwo = 0x141E8;
        public const int Tick = 0x14278;
        public const int Period = 0x142D4;
        public const int LifecycleStateA = 0x142F8;
        public const int LifecycleStateB = 0x142F9;
        public const int LifecycleStateC = 0x142FA;
        public const int LifecycleStateD = 0x142FB;
    }

    public static class MomentumEventSource
    {
        public const int EventsBegin = 0x08;
        public const int EventsEnd = 0x10;
        public const int HalfPitchWidth = 0x108;
        public const int HalfPitchLength = 0x10C;
        public const int FirstHalfEndTick = 0x110;
        public const int FullTimeEndTick = 0x114;
        public const int ExtraTimeFirstHalfEndTick = 0x118;
        public const int ExtraTimeFlag = 0x11C;
    }

    public static class MomentumEvent
    {
        public const int Size = 0x38;
        public const int TrajectoryPointsBegin = 0x00;
        public const int TrajectoryPointsEnd = 0x08;
        public const int TrajectoryPointsCapacity = 0x10;
        public const int TrajectoryPointSize = 0x08;
        public const int LateralPosition = 0x18;
        public const int LongitudinalPosition = 0x1C;
        public const int Tick = 0x22;
        // Display-clock minute/second at event start. In the second half these exclude
        // first-half stoppage ticks and resume at 45:xx instead of using raw event Tick.
        // public const int EventMinute = 0x25;
        // public const int EventSecond = 0x26;
        // Zero-based index into Team.PlayerTable (+0x130)
        public const int PlayerSlot = 0x27;
        public const int Team = 0x28;
        // Uses the same team-roster slot space as PlayerSlot; 0xFF means that
        // the event has no receiver/destination player.
        public const int ReceiverPlayerSlot = 0x29;
        public const int EventType = 0x2A;
        public const int SequenceIndex = 0x2C;
        public const int Flags = 0x30;
        public const int CompletionTick = 0x32;
        public const int ReverseDirectionMask = 0x100;

        // Present on completed ball-action records, including unsuccessful passes
        // and saved shots. It does not by itself mean that the action succeeded.
        public const ushort BallActionFlag = 0x01;
        public const ushort CompletedFlag = BallActionFlag;
        public const ushort KeyPassFlag = 0x02;
        public const ushort AssistFlag = 0x04;
        public const ushort ThrowInFlag = 0x08;
        public const ushort AttackingFreeKickFlag = 0x10;
        public const ushort DefensiveFreeKickFlag = 0x20;

        public const byte ShotGoal = 1;
        public const byte ShotMissedTarget = 2;
        public const byte ShotHitWoodwork = 3;
        public const byte ShotSaved = 4;
        public const byte ShotBlocked = 5;
        public const byte PassIncompleteD = 6;
        public const byte PassCompleted = 7;
        public const byte PassTurnedOver = 8;
        public const byte PassBlockedOrClearedCandidate = 9;
        public const byte PassIncompleteB = 10;
        public const byte PassIncompleteC = 11;
        public const byte CrossCompleted = 12;
        public const byte CrossIncompleteA = 13;
        public const byte CrossInterceptedCandidate = CrossIncompleteA;
        public const byte CrossIncompleteB = 14;
        public const byte CrossIncompleteC = 15;
        public const byte CrossIncompleteD = 16;
        public const byte CrossIncompleteE = 17;
        public const byte Fouled = 18;
        public const byte FoulCommittedA = 19;
        public const byte FoulCommittedB = 20;
        public const byte FoulCommittedC = 21;
        public const byte UnknownEvent22 = 22;
        public const byte Offside = 23;
        public const byte BallHandledOrKnockedAway = 24;
        public const byte DefensiveShotBlock = 25;
        public const byte TackleWon = 26;
        public const byte TackleLost = 27;
        public const byte AerialWon = 28;
        public const byte AerialLost = 29;
        public const byte UnknownEvent30 = 30;
        public const byte Interception = 31;
        public const byte UnknownEvent32 = 32;
        public const byte UnknownEvent33 = 33;
        public const byte DribbleCompleted = 34;
        // Co-located auxiliary record on a user-confirmed Watkins headed goal.
        // Keep as a candidate until another headed/non-headed goal comparison.
        // public const byte HeadedGoalAuxiliaryCandidate = 35;
        // public const byte GoalAuxiliaryCandidateB = 36;
        public const byte GoalkeeperSaveHeld = 37;
        public const byte GoalkeeperSaveParried = 38;
        public const byte GoalkeeperActionC = 39;
        public const byte UnknownEvent40 = 40;
        public const byte UnknownEvent41 = 41;
        public const byte UnknownEvent42 = 42;
        public const byte UnknownEvent43 = 43;
        public const byte UnknownEvent44 = 44;
        public const byte UnknownEvent45 = 45;
        public const byte UnknownEvent46 = 46;
        public const byte HeaderAction = 47;
        public const byte UnknownEvent48 = 48;
        public const byte UnknownEvent49 = 49;
        public const byte UnknownEvent50 = 50;
        public const byte UnknownEvent51 = 51;
        public const byte PossessionGained = 52;
        public const byte PossessionLost = 53;
        public const byte Touch = 54;
        public const byte UnknownEvent55 = 55;
    }

    // Input object consumed by FUN_1823073e0/FUN_182868850 while producing or
    // annotating a MomentumEvent. These are not offsets inside the 0x38 output record.
    public static class RawMomentumEvent
    {
        public const int Tick = 0x44;
        public const int Flags = 0x64;
        public const int EventType = 0x68;
        public const int Team = 0x6A;
        public const int PlayerSlot = 0x6B;
    }

    public static class MomentumEventTrajectoryPoint
    {
        public const int LateralPosition = 0x00;
        public const int LongitudinalPosition = 0x04;
    }

    public static class Team
    {
        // Pointer to the team's manager wrapper. Manager.Person resolves to the
        // shared Person subobject for both human managers and AI staff.
        public const int Manager = 0x528;
        public const int PlayerTable = 0x130;
        public const int PlayerCount = 0x632;
        public const int UniqueId = 0x2C;
        public const int BackgroundColour = 0x30;
        public const int ForegroundColour = 0x34;
        public const int OutlineColour = 0x38;
        public const int ContainerUniqueId = 0x8C;
        public const int LogoNumber = 0x126;
        public const int DbTeam = 0xA8;
        public const int PlayerListUnconfirmed = 0x200;
        public const int TeamBase = 0x588;
    }

    public static class Manager
    {
        public const int Person = 0x28;
    }

    public static class Rtti
    {
        // MSVC object layout: [person] is the vftable, [vftable-8] points to
        // RTTI metadata, whose +4 field is the complete-object/subobject offset.
        public const int Metadata = -0x08;
        public const int SubobjectOffset = 0x04;
        public const uint HumanManagerPersonOffset = 0x450;
        public const uint StaffPersonOffset = 0x100;
    }

    public static class StadiumColour
    {
        public const int PrimaryColour = 0x148;
        public const int SecondaryColour = 0x14C;
    }

    public static class DbTeam
    {
        public const int Uid = 0x0C;
        public const int Club = 0x30;
        public const int Competition = 0x50;
        public const int Stadium = 0x78;
        public const int Schedule = 0xA0;
    }

    public static class Schedule
    {
        public const int PreviousMatch = 0x00;
        public const int CurrentMatch = 0x28;
    }

    public static class ScheduleMatch
    {
        public const int Size = 0x28;
        public const int Team = 0x08;
        public const int Opponent = 0x10;
        // uint32 FM date: year = raw >> 16, one-based day-of-year = raw & 0x1FF.
        public const int Date = 0x18;
        // Confirmed score pair. Home/away versus team/opponent orientation still
        // needs an away-team historical sample before assigning semantic names.
        public const int FirstScore = 0x20;
        public const int SecondScore = 0x21;
    }

    public static class Club
    {
        public const int Uid = 0x0C;
        public const int Name = 0xC0;
        public const int ShortName = 0xC8;
    }

    public static class TeamBase
    {
        public const int Xg = 0x60;
        public const int PossessionTime = 0x7C;
        public const int Unknown84 = 0x84;
        public const int Crosses = 0xD4;
        public const int CrossesCompleted = 0xD6;
        public const int Passes = 0xD8;
        public const int PassesCompleted = 0xDA;
        public const int TacklesAttempted = 0xDE;
        public const int TacklesWon = 0xE0;
        public const int Aerials = 0xE4;
        public const int AerialsWon = 0xE6;
        public const int ProgressivePasses = 0x142;
        public const int Goals = 0x160;
        public const int Shots = 0x16F;
        public const int ShotsOnTarget = 0x170;
        public const int Unknown172 = 0x172;
        public const int BlockedShots = 0x175;
        public const int ClearCutChances = 0x176;
        public const int FinalThirdPasses = 0x188;
        public const int Corners = 0x19D;
        public const int Fouls = 0x1A0;
        public const int Offsides = 0x1A1;
        public const int YellowCardsUnconfirmed = 0x1A2;
        public const int RedCardsUnconfirmed = 0x1A3;
        public const int MatchSquadUnconfirmed = 0x250;
    }

    public static class MatchPlayer
    {
        public const int Person = 0x28;
        public const int PositionX = 0x80;
        public const int PositionY = 0x84;
        public const int PositionXAlt = 0x140;
        public const int PositionYAlt = 0x144;
        public const int PositionHistory = 0x170;
        public const int UnknownFloatArray = 0x180;
        public const int TimerStartTick = 0x200;
        public const int TimerEndTick = 0x208;
        public const int MatchTick = 0x2A8;
        public const int InPossessionPosition = 0xD50;
        public const int InPossessionRoleDuty = 0xD90;
        public const int OutOfPossessionPosition = 0xDE0;
        public const int OutOfPossessionRoleDuty = 0xE20;
        public const int Stats = 0x1800;
    }

    public static class PositionHistory
    {
        public const int PositionX = 0x0;
        public const int PositionY = 0x4;
        public const int PositionZ = 0x8; //unconfirmed
        public const int Flags = 0xC; //unconfirmed
        public const int Speed = 0x10; //speed
        public const int Angle = 0x14; //angle (PositionX=0,PositionY=1)=0,clock+
    }

    public static class Person
    {
        public const int ActualPlayerDelta = -0x288;
        public const int Uid = 0x0C;
        public const int FemaleBit = 0x10;
        public const int Gender = 0x19;
        public const int FirstName = 0x50;
        public const int SecondName = 0x58;
        public const int CommonName = 0x60;
        public const int Nation = 0x68;
        public const int City = 0x80;
        // uint32 FM date: year = raw >> 16, one-based day-of-year = raw & 0x1FF.
        public const int DateOfBirth = 0x88;
        public const int FullContract = 0xA8;

        // 64-bit player-trait bitfield spanning Person + 0xC0 through Person + 0xC7.
        public const int Traits = 0xC0;
        // Bit 0 (+0xC0 bit 0, mask 0x01): Runs With Ball Down Left
        public const ulong RunsWithBallDownLeft = 1UL << 0;
        // Bit 1 (+0xC0 bit 1, mask 0x02): Runs With Ball Down Right
        public const ulong RunsWithBallDownRight = 1UL << 1;
        // Bit 2 (+0xC0 bit 2, mask 0x04): Runs With Ball Down Center
        public const ulong RunsWithBallDownCenter = 1UL << 2;
        // Bit 3 (+0xC0 bit 3, mask 0x08): Gets Into Opposition Area
        public const ulong GetsIntoOppositionArea = 1UL << 3;
        // Bit 4 (+0xC0 bit 4, mask 0x10): Moves Into Channels
        public const ulong MovesIntoChannels = 1UL << 4;
        // Bit 5 (+0xC0 bit 5, mask 0x20): Gets Forward Whenever Possible
        public const ulong GetsForwardWheneverPossible = 1UL << 5;
        // Bit 6 (+0xC0 bit 6, mask 0x40): Plays Short Simple Passes
        public const ulong PlaysShortSimplePasses = 1UL << 6;
        // Bit 7 (+0xC0 bit 7, mask 0x80): Tries Killer Balls Often
        public const ulong TriesKillerBallsOften = 1UL << 7;
        // Bit 8 (+0xC1 bit 0, mask 0x01): Shoots From Distance
        public const ulong ShootsFromDistance = 1UL << 8;
        // Bit 9 (+0xC1 bit 1, mask 0x02): Shoots With Power
        public const ulong ShootsWithPower = 1UL << 9;
        // Bit 10 (+0xC1 bit 2, mask 0x04): Places Shots
        public const ulong PlacesShots = 1UL << 10;
        // Bit 11 (+0xC1 bit 3, mask 0x08): Curls Ball
        public const ulong CurlsBall = 1UL << 11;
        // Bit 12 (+0xC1 bit 4, mask 0x10): Likes To Round Keeper
        public const ulong LikesToRoundKeeper = 1UL << 12;
        // Bit 13 (+0xC1 bit 5, mask 0x20): Likes To Try To Break Offside Trap
        public const ulong LikesToTryToBreakOffsideTrap = 1UL << 13;
        // Bit 14 (+0xC1 bit 6, mask 0x40): Uses Outside Of Foot
        public const ulong UsesOutsideOfFoot = 1UL << 14;
        // Bit 15 (+0xC1 bit 7, mask 0x80): Marks Opponent Tightly
        public const ulong MarksOpponentTightly = 1UL << 15;
        // Bit 16 (+0xC2 bit 0, mask 0x01): Winds Up Opponents
        public const ulong WindsUpOpponents = 1UL << 16;
        // Bit 17 (+0xC2 bit 1, mask 0x02): Argues With Officials
        public const ulong ArguesWithOfficials = 1UL << 17;
        // Bit 18 (+0xC2 bit 2, mask 0x04): Plays With Back To Goal
        public const ulong PlaysWithBackToGoal = 1UL << 18;
        // Bit 19 (+0xC2 bit 3, mask 0x08): Comes Deep To Get Ball
        public const ulong ComesDeepToGetBall = 1UL << 19;
        // Bit 20 (+0xC2 bit 4, mask 0x10): Plays One-Twos
        public const ulong PlaysOneTwos = 1UL << 20;
        // Bit 21 (+0xC2 bit 5, mask 0x20): Likes To Lob Keeper
        public const ulong LikesToLobKeeper = 1UL << 21;
        // Bit 22 (+0xC2 bit 6, mask 0x40): Dictates Tempo
        public const ulong DictatesTempo = 1UL << 22;
        // Bit 23 (+0xC2 bit 7, mask 0x80): Attempts Overhead Kicks
        public const ulong AttemptsOverheadKicks = 1UL << 23;
        // Bit 24 (+0xC3 bit 0, mask 0x01): Looks For Pass Rather Than Attempting To Score
        public const ulong LooksForPassRatherThanAttemptingToScore = 1UL << 24;
        // Bit 25 (+0xC3 bit 1, mask 0x02): Plays No Through Balls
        public const ulong PlaysNoThroughBalls = 1UL << 25;
        // Bit 26 (+0xC3 bit 2, mask 0x04): Stops Play
        public const ulong StopsPlay = 1UL << 26;
        // Bit 27 (+0xC3 bit 3, mask 0x08): Knocks Ball Past Opponent
        public const ulong KnocksBallPastOpponent = 1UL << 27;
        // Bit 28 (+0xC3 bit 4, mask 0x10): Moves Ball To Right Foot Before Dribble Attempt
        public const ulong MovesBallToRightFootBeforeDribbleAttempt = 1UL << 28;
        // Bit 29 (+0xC3 bit 5, mask 0x20): Moves Ball To Left Foot Before Dribble Attempt
        public const ulong MovesBallToLeftFootBeforeDribbleAttempt = 1UL << 29;
        // Bit 30 (+0xC3 bit 6, mask 0x40): Dwells On Ball
        public const ulong DwellsOnBall = 1UL << 30;
        // Bit 31 (+0xC3 bit 7, mask 0x80): Arrives Late In Opponents' Area
        public const ulong ArrivesLateInOpponentsArea = 1UL << 31;
        // Bit 32 (+0xC4 bit 0, mask 0x01): Tries To Play Way Out Of Trouble
        public const ulong TriesToPlayWayOutOfTrouble = 1UL << 32;
        // Bit 33 (+0xC4 bit 1, mask 0x02): Stays Back At All Times
        public const ulong StaysBackAtAllTimes = 1UL << 33;
        // Bit 34 (+0xC4 bit 2, mask 0x04): Avoids Using Weaker Foot
        public const ulong AvoidsUsingWeakerFoot = 1UL << 34;
        // Bit 35 (+0xC4 bit 3, mask 0x08): Tries Tricks
        public const ulong TriesTricks = 1UL << 35;
        // Bit 36 (+0xC4 bit 4, mask 0x10): Tries Long Range Free Kicks
        public const ulong TriesLongRangeFreeKicks = 1UL << 36;
        // Bit 37 (+0xC4 bit 5, mask 0x20): Dives Into Tackles
        public const ulong DivesIntoTackles = 1UL << 37;
        // Bit 38 (+0xC4 bit 6, mask 0x40): Does Not Dive Into Tackles
        public const ulong DoesNotDiveIntoTackles = 1UL << 38;
        // Bit 39 (+0xC4 bit 7, mask 0x80): Cuts Inside From Both Wings
        public const ulong CutsInsideFromBothWings = 1UL << 39;
        // Bit 40 (+0xC5 bit 0, mask 0x01): Hugs Line
        public const ulong HugsLine = 1UL << 40;
        // Bit 41 (+0xC5 bit 1, mask 0x02): Gets Crowd Going
        public const ulong GetsCrowdGoing = 1UL << 41;
        // Bit 42 (+0xC5 bit 2, mask 0x04): Tries First Time Shots
        public const ulong TriesFirstTimeShots = 1UL << 42;
        // Bit 43 (+0xC5 bit 3, mask 0x08): Tries Long Range Passes
        public const ulong TriesLongRangePasses = 1UL << 43;
        // Bit 44 (+0xC5 bit 4, mask 0x10): Likes Ball Played Into Feet
        public const ulong LikesBallPlayedIntoFeet = 1UL << 44;
        // Bit 45 (+0xC5 bit 5, mask 0x20): Hits Free Kick With Power
        public const ulong HitsFreeKickWithPower = 1UL << 45;
        // Bit 46 (+0xC5 bit 6, mask 0x40): Likes To Beat Man Repeatedly
        public const ulong LikesToBeatManRepeatedly = 1UL << 46;
        // Bit 47 (+0xC5 bit 7, mask 0x80): Likes To Switch Ball To Other Flank
        public const ulong LikesToSwitchBallToOtherFlank = 1UL << 47;
        // Bit 48 (+0xC6 bit 0, mask 0x01): Unknown / undefined
        public const ulong UnknownTraitBit48 = 1UL << 48;
        // Bit 49 (+0xC6 bit 1, mask 0x02): Unknown / undefined
        public const ulong UnknownTraitBit49 = 1UL << 49;
        // Bit 50 (+0xC6 bit 2, mask 0x04): Possesses Long Flat Throw
        public const ulong PossessesLongFlatThrow = 1UL << 50;
        // Bit 51 (+0xC6 bit 3, mask 0x08): Runs With Ball Often
        public const ulong RunsWithBallOften = 1UL << 51;
        // Bit 52 (+0xC6 bit 4, mask 0x10): Runs With Ball Rarely
        public const ulong RunsWithBallRarely = 1UL << 52;
        // Bit 53 (+0xC6 bit 5, mask 0x20): Unknown / undefined
        public const ulong UnknownTraitBit53 = 1UL << 53;
        // Bit 54 (+0xC6 bit 6, mask 0x40): Does Not Move Into Channels
        public const ulong DoesNotMoveIntoChannels = 1UL << 54;
        // Bit 55 (+0xC6 bit 7, mask 0x80): Uses Long Throw To Start Counter Attacks
        public const ulong UsesLongThrowToStartCounterAttacks = 1UL << 55;
        // Bit 56 (+0xC7 bit 0, mask 0x01): Refrains From Taking Long Shots
        public const ulong RefrainsFromTakingLongShots = 1UL << 56;
        // Bit 57 (+0xC7 bit 1, mask 0x02): Cuts Inside From Left Wing
        public const ulong CutsInsideFromLeftWing = 1UL << 57;
        // Bit 58 (+0xC7 bit 2, mask 0x04): Cuts Inside From Right Wing
        public const ulong CutsInsideFromRightWing = 1UL << 58;
        // Bit 59 (+0xC7 bit 3, mask 0x08): Crosses Early
        public const ulong CrossesEarly = 1UL << 59;
        // Bit 60 (+0xC7 bit 4, mask 0x10): Brings Ball Out Of Defense
        public const ulong BringsBallOutOfDefense = 1UL << 60;
        // Bit 61 (+0xC7 bit 5, mask 0x20): Unknown / undefined
        public const ulong UnknownTraitBit61 = 1UL << 61;
        // Bit 62 (+0xC7 bit 6, mask 0x40): Unknown / undefined
        public const ulong UnknownTraitBit62 = 1UL << 62;
        // Bit 63 (+0xC7 bit 7, mask 0x80): Plays Ball With Feet
        public const ulong PlaysBallWithFeet = 1UL << 63;

        public const int InternationalApps = 0x134;  //byte
        public const int InternationalGoals = 0x136; //byte
        public const int YouthApps = 0x138;          //byte
        public const int YouthGoals = 0x13A;         //byte
    }

    public static class Nation
    {
        public const int Uid = 0x0C;
        public const int NationName = 0x18;
        public const int NationalityName = 0x30;
    }

    public static class FullContract
    {
        public const int WeeklyWage = 0x20;
        public const int Expiry = 0x48;
        public const int StatusFlags = 0x57;
        public const int SquadNumber = 0x5D;
    }

    public static class Name
    {
        public const int CharacterBuffer = 0x0;
        public const int Text = 0x4;
        public const int MaxLength = 64;
    }

    public static class ActualPlayer
    {
        public const int Id = 0x8;
        public const int ObjDuni = 0xC;
        public const int PositionGk = 0x150;
        public const int Crossing = 0x15F;
        public const int Dribbling = 0x160;
        public const int Finishing = 0x161;
        public const int Heading = 0x162;
        public const int LongShots = 0x163;
        public const int Marking = 0x164;
        public const int OffTheBall = 0x165;
        public const int Passing = 0x166;
        public const int PenaltyTaking = 0x167;
        public const int Tackling = 0x168;
        public const int Vision = 0x169;
        public const int Handling = 0x16A;
        public const int AerialReach = 0x16B;
        public const int CommandOfArea = 0x16C;
        public const int Communication = 0x16D;
        public const int Kicking = 0x16E;
        public const int Throwing = 0x16F;
        public const int Anticipation = 0x170;
        public const int Decisions = 0x171;
        public const int OneOnOnes = 0x172;
        public const int Positioning = 0x173;
        public const int Reflexes = 0x174;
        public const int FirstTouch = 0x175;
        public const int Technique = 0x176;
        public const int LeftFoot = 0x177;
        public const int RightFoot = 0x178;
        public const int Flair = 0x179;
        public const int Corners = 0x17A;
        public const int Teamwork = 0x17B;
        public const int WorkRate = 0x17C;
        public const int LongThrows = 0x17D;
        public const int Eccentricity = 0x17E;
        public const int RushingOut = 0x17F;
        public const int Punching = 0x180;
        public const int Acceleration = 0x181;
        public const int FreeKicks = 0x182;
        public const int Strength = 0x183;
        public const int Stamina = 0x184;
        public const int Pace = 0x185;
        public const int JumpingReach = 0x186;
        public const int Leadership = 0x187;
        public const int Balance = 0x189;
        public const int Bravery = 0x18A;
        public const int Aggression = 0x18C;
        public const int Agility = 0x18D;
        public const int NaturalFitness = 0x191;
        public const int Determination = 0x192;
        public const int Composure = 0x193;
        public const int Concentration = 0x194;
        public const int Height = 0x22E;
        // 1 Ectomorph 2 Ecto-Mesomorph 3 Mesomorph 4 Meso-Endomorph 5 Endomorph
        public const int BodyType = 0x230;
        public const int GuideValueGbp = 0x234; //u32
        public const int TransferValue = 0x238; //u32
        public const int Condition = 0x258;
        public const int CurrentReputation = 0x260;
        public const int CurrentAbility = 0x264;
        public const int PotentialAbility = 0x266;
        public const int Morale = 0x26C;
    }

    public static class PlayerStats
    {
        // Observed to repeat between different players, even within one team.
        // This is not a database identity; use MatchPlayer.Person -> Person.Uid.
        public const int NonUniqueMatchStatKey = 0x18;
        public const int Xg = 0x1C;
        public const int XgRelatedUnconfirmed = 0x20;
        public const int Xa = 0x24;
        public const int XaRelatedUnconfirmed = 0x28;
        public const int StarterSubstituteFlag = 0x5C;
        public const int DistanceM = 0x68;
        public const int EventTimestamp = 0x78;
        public const int RatingTimes100 = 0x82;
        public const int TeamSideUnconfirmed = 0x87;
        // 255 health, 13 slight injury, 10 knee injury, 8 5w-6w injury, 11 foot injury
        // public const int InjuryStateOrSeverityCandidate = 0x88;
        public const int OverallPhysicalCondition = 0x89;
        public const int MatchSharpness = 0x8A;
        public const int Goals = 0x8B;
        public const int Penalties = 0x8E;
        public const int OwnGoals = 0x8F;
        public const int Shots = 0x90;
        public const int ShotsOnTarget = 0x91;
        public const int BlockedShotsUnconfirmed = 0x92;
        public const int ClearCutChances = 0x94;
        public const int HitWoodwork = 0x96;
        public const int SavesHeld = 0x99;
        public const int SavesParried = 0x9A;
        public const int SavesTipped = 0x9B;
        public const int Assists = 0x9F;
        public const int Dribbles = 0xA1;
        public const int Fouls = 0xA3;
        public const int Fouled = 0xA4;
        public const int SubbedOffMinute = 0xAA;
        public const int SubbedOnMinute = 0xAF;
        public const int Crosses = 0xB5;
        public const int CrossesCompleted = 0xB6;
        public const int Passes = 0xBA;
        public const int PassesCompleted = 0xBB;
        public const int KeyPasses = 0xBC;
        public const int TacklesAttempted = 0xBE;
        public const int TacklesWon = 0xBF;
        public const int KeyTackles = 0xC0;
        public const int Aerials = 0xC2;
        public const int AerialsWon = 0xC3;
        public const int Interceptions = 0xC7;
        public const int ThrowIns = 0xCB;
        public const int Corners = 0xCC;
        public const int DefensiveFreeKicks = 0xCD;
        public const int AttackingFreeKicks = 0xCE;
        public const int Clearances = 0xD1;
        public const int ShotsFaced = 0xD5;
    }
}
