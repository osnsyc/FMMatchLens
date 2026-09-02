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
        public const int LateralPosition = 0x18;
        public const int LongitudinalPosition = 0x1C;
        public const int Tick = 0x22;
        public const int PlayerSlot = 0x27;
        public const int Team = 0x28;
        public const int ReceiverPlayerSlot = 0x29;
        public const int EventType = 0x2A;
        public const int Flags = 0x30;
        public const int ReverseDirectionMask = 0x100;

        public const byte ShotGoal = 1;
        public const byte ShotMissedTarget = 2;
        public const byte ShotHitWoodwork = 3;
        public const byte ShotSaved = 4;
        public const byte ShotBlocked = 5;
        public const byte PassCompleted = 7;
        public const byte PassIncompleteA = 8;
        public const byte PassIncompleteB = 10;
        public const byte PassIncompleteC = 11;
        public const byte CrossCompleted = 12;
        public const byte CrossIncompleteA = 13;
        public const byte CrossIncompleteB = 14;
        public const byte CrossIncompleteC = 15;
        public const byte CrossIncompleteD = 16;
        public const byte Fouled = 18;
        public const byte FoulCommittedA = 19;
        public const byte FoulCommittedB = 20;
        public const byte TackleWon = 26;
        public const byte TackleLost = 27;
        public const byte AerialWon = 28;
        public const byte AerialLost = 29;
        public const byte Interception = 31;
        public const byte DribbleCompleted = 34;
        public const byte Touch = 54;
    }

    public static class MomentumWeightingTable
    {
        public const int GlobalRva = 0x4E375F8;
        public const int EntriesBegin = 0x08;
        public const int EntriesEnd = 0x10;
        public const int EntrySize = 0x08;
        public const int EventType = 0x00;
        public const int VerticalSixth = 0x01;
        public const int HorizontalThird = 0x02;
        public const int Weight = 0x04;
    }

    public static class Team
    {
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
        public const int DateOfBirth = 0x88;
        public const int FullContract = 0xA8;
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
        public const int GuideValueGbp = 0x234;
        public const int TransferValue = 0x238;
        public const int Condition = 0x258;
        public const int CurrentReputation = 0x260;
        public const int CurrentAbility = 0x264;
        public const int PotentialAbility = 0x266;
        public const int Morale = 0x26C;
    }

    public static class PlayerStats
    {
        public const int Id = 0x18;
        public const int Xg = 0x1C;
        public const int XgRelatedUnconfirmed = 0x20;
        public const int Xa = 0x24;
        public const int XaRelatedUnconfirmed = 0x28;
        public const int StarterSubstituteFlag = 0x5C;
        public const int DistanceM = 0x68;
        public const int EventTimestamp = 0x78;
        public const int RatingTimes100 = 0x82;
        public const int TeamSideUnconfirmed = 0x87;
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
